/**
 * Configuration
 */
const API_8X8_KEY = "INSERT_API_KEY_HERE"; // Insert your 8x8 Connect API Key
const SUB_ACCOUNT_ID = "INSERT_SUBACCOUNT_HERE"; // Add your 8x8 subAccount ID here
const API_8X8_URL = "https://chatapps.8x8.com/api/v1/subaccounts"; //Do Not Modify


// Session timeout in seconds, new session gets generated afterwards
// Disable by setting to 0
const SESSION_TIMEOUT = 1800;


const HIDE_USER_ID = true;
const HIDE_SESSION_ID = true;
// Method used for hiding
const HASH_ALGORITHM = "sha256";


/**
 * WhatsApp message interfaces
 */
interface I8x8MessageBase {
    from: string;
    contentType: string;
}


interface I8x8TextMessage extends I8x8MessageBase {
    contentType: 'text';
    text: string;
}


interface I8x8ImageMessage extends I8x8MessageBase {
    contentType: 'image';
    image: {
        url: string;
        text?: string;
    }
}


interface I8x8AudioMessage extends I8x8MessageBase {
    contentType: 'audio';
    audio: {
        url: string;
    }
}


interface I8x8VideoMessage extends I8x8MessageBase {
    contentType: 'video';
    video: {
        url: string;
        text?: string;
    }
}


interface I8x8TemplateMessage extends I8x8MessageBase {
    contentType: 'template';
    template: {
        name: string;
        language: string;
        components: any[];
    };
}


interface I8x8InteractiveMessage extends I8x8MessageBase {
    contentType: 'interactive';
    interactive: {
        type: string;
        header?: {
            type: string;
            text: string;
        };
        body: {
            text: string;
        };
        footer?: {
            text: string;
        };
        action: any;
    };
}


type T8x8Content = I8x8TextMessage | I8x8ImageMessage | I8x8AudioMessage | I8x8VideoMessage | I8x8TemplateMessage | I8x8InteractiveMessage;


/**
 * Converts Cognigy output to 8x8 format
 */
function convertCognigyTo8x8(output: any, sessionId: string): T8x8Content {
    if (output.text && !output.data?._cognigy?._default) {
        return {
            from: sessionId,
            contentType: "text",
            text: output.text
        };
    } else if (output.data?._cognigy?._default) {
        const defaultContent = output.data._cognigy._default;


        if (defaultContent._image) {
            return {
                from: sessionId,
                contentType: "image",
                image: {
                    url: defaultContent._image.imageUrl,
                    text: defaultContent._image.fallbackText || ""
                }
            };
        } else if (defaultContent._audio) {
            return {
                from: sessionId,
                contentType: "audio",
                audio: {
                    url: defaultContent._audio.audioUrl
                }
            };
        } else if (defaultContent._video) {
            return {
                from: sessionId,
                contentType: "video",
                video: {
                    url: defaultContent._video.videoUrl,
                    text: defaultContent._video.fallbackText || ""
                }
            };
        } else if (defaultContent._quickReplies) {
            return convertQuickRepliesTo8x8Interactive(defaultContent._quickReplies, sessionId);
        }
    }


    // Default to text message if no matching type is found
    return {
        from: sessionId,
        contentType: "text",
        text: output.text || "No content"
    };
}


function convertQuickRepliesTo8x8Interactive(quickReplies: any, sessionId: string): I8x8InteractiveMessage {
    return {
        from: sessionId,
        contentType: "interactive",
        interactive: {
            type: "button",
            body: {
                text: quickReplies.text
            },
            action: {
                buttons: quickReplies.quickReplies.map((qr: any, index: number) => ({
                    type: "reply",
                    reply: {
                        id: `option-${index + 1}`,
                        title: qr.title
                    }
                }))
            }
        }
    };
}


createWebhookTransformer({
    handleInput: async ({ request, response }) => {
        try {
            const payload = request.body;
            console.log("Incoming webhook payload: " + JSON.stringify(payload, null, 2));


            if (payload.eventType !== "inbound_message_received") {
                return null;
            }


            const clearUserId = payload.payload.user.msisdn;
            const clearSessionId = payload.payload.recipient.channelId;


            if (!clearUserId || !clearSessionId) {
                console.error(`Missing userId or sessionId in incoming message`);
                return null;
            }


            let userId = clearUserId;
            let sessionId = clearSessionId;


            if (HIDE_USER_ID) {
                userId = hashString(userId);
            }
            if (HIDE_SESSION_ID) {
                sessionId = hashString(sessionId);
            }


            let text = payload.payload.content.text;
            const data = payload.payload;


            return {
                userId,
                sessionId,
                text,
                data
            };
        } catch (error) {
            console.error('Error in handleInput:');
            console.error(error);
            return null;
        }
    },


    handleOutput: async ({ output, userId, sessionId }) => {
        try {
            const sessionStorage = await getSessionStorage(userId, sessionId);
            const clearUserId = sessionStorage.clearUserId || userId;
            const clearSessionId = sessionStorage.clearSessionId || sessionId;


            const message: T8x8Content = convertCognigyTo8x8(output, clearSessionId);


            if (!message) {
                console.error("Missing 8x8 compatible channel output!");
                return null;
            }


            return await sendSingleMessage(clearUserId, message);
        } catch (error) {
            console.error('Error in handleOutput:');
            console.error(error);
            return null;
        }
    },


    handleExecutionFinished: async ({ sessionId, userId, endpoint }) => {
        // Clean up or perform any necessary actions after execution is finished
    }
});


/**
 * Sends a single message using 8x8 Messaging API
 */
async function sendSingleMessage(to: string, message: T8x8Content) {
    const requestBody: any = {
        user: {
            msisdn: to
        },
        type: message.contentType,
        content: {}
    };


    switch (message.contentType) {
        case 'text':
            requestBody.content = { text: (message as I8x8TextMessage).text };
            break;
        case 'image':
            requestBody.content = (message as I8x8ImageMessage).image;
            break;
        case 'audio':
            requestBody.content = (message as I8x8AudioMessage).audio;
            break;
        case 'video':
            requestBody.content = (message as I8x8VideoMessage).video;
            break;
        case 'template':
            requestBody.content = { template: (message as I8x8TemplateMessage).template };
            break;
        case 'interactive':
            requestBody.content = (message as I8x8InteractiveMessage).interactive;
            break;
    }


    const webhookUrl = `${API_8X8_URL}/${SUB_ACCOUNT_ID}/messages`;

    try {
        const response = await httpRequest({
            uri: webhookUrl,
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_8X8_KEY}`
            },
            body: requestBody,
            json: true
        });
        
        return response;
    } catch (error) {
        console.error("Error in sendSingleMessage:", error);
        if (error.response) {
            console.error("Error response:", JSON.stringify(error.response.body, null, 2));
        }
        throw error;
    }
}


function hashString(str: string): string {
    return crypto.createHash(HASH_ALGORITHM).update(str).digest('hex');
}
