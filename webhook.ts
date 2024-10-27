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
        text?: string;  // Added for body text
        components?: Array<{
            type: string;
            index?: number;
            subType?: string;
            parameters: Array<{
                type: string;
                text?: string;
                url?: string;  // Added for image URL
            }>;
        }>;
    };
}

interface I8x8InteractiveMessage extends I8x8MessageBase {
    contentType: 'interactive';
    interactive: {
        type: 'button';  // Required
        header?: {       // Optional
            type: 'text';
            text: string;
        };
        body: {          // Required
            text: string;
        };
        footer?: {       // Optional
            text: string;
        };
        action: {        // Required
            buttons: Array<{
                type: 'reply';
                reply: {
                    id: string;
                    title: string;
                }
            }>
        };
    };
}

type T8x8Content = I8x8TextMessage | I8x8ImageMessage | I8x8AudioMessage | I8x8VideoMessage | I8x8TemplateMessage | I8x8InteractiveMessage;

/**
 * Converts Cognigy output to 8x8 format
 */
function convertCognigyTo8x8(output: any, sessionId: string): T8x8Content {
    console.log("Converting Cognigy output:");
    console.log(JSON.stringify(output, null, 2));

    const defaultContent = output.data?._cognigy?._default;
    
    if (defaultContent?._template) {
        console.log("Found template in default content:");
        console.log(JSON.stringify(defaultContent._template, null, 2));
        
        return {
            from: sessionId,
            contentType: "template",
            template: {
                name: defaultContent._template.name,
                language: defaultContent._template.language || "en",
                components: defaultContent._template.components || []
            }
        };
    }

    // Default to text message
    return {
        from: sessionId,
        contentType: "text",
        text: output.text || "No content"
    };
}

function convertQuickRepliesTo8x8Interactive(data: any, sessionId: string): I8x8InteractiveMessage {
    console.log("Converting quick replies to interactive message:");
    console.log(JSON.stringify(data, null, 2));

    return {
        from: sessionId,
        contentType: "interactive",
        interactive: {
            type: "button",
            header: data.header ? {
                type: "text",
                text: data.header
            } : undefined,
            body: {
                text: data.text || "Please select an option"
            },
            footer: data.footer ? {
                text: data.footer
            } : undefined,
            action: {
                buttons: (data.quickReplies || [])
                    .slice(0, 3) // WhatsApp limit of 3 buttons
                    .map((qr: any, index: number) => ({
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

            // Store clearUserId and clearSessionId in sessionStorage
            const sessionStorage = await getSessionStorage(userId, sessionId);
            sessionStorage.clearUserId = clearUserId;
            sessionStorage.clearSessionId = clearSessionId;

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
            console.log("=== START HANDLE OUTPUT ===");
            console.log("Raw output received:");
            console.log(JSON.stringify(output, null, 2));

            const sessionStorage = await getSessionStorage(userId, sessionId);
            const clearUserId = sessionStorage.clearUserId;
            const clearSessionId = sessionStorage.clearSessionId;

            if (!clearUserId) {
                console.error("Missing clearUserId in session storage");
                return null;
            }

            // Handle different message types
            if (output.data?._cognigy?._default?._video) {
                console.log("Found video data:");
                console.log(JSON.stringify(output.data._cognigy._default._video, null, 2));
                
                const videoData = output.data._cognigy._default._video;
                return await sendSingleMessage(clearUserId, {
                    from: clearSessionId,
                    contentType: "video",
                    video: {
                        url: videoData.videoUrl,
                        text: videoData.fallbackText || videoData.videoAltText || ""
                    }
                });
            } else if (output.data?._cognigy?._default?._image) {
                console.log("Found image data:");
                console.log(JSON.stringify(output.data._cognigy._default._image, null, 2));
                
                const imageData = output.data._cognigy._default._image;
                return await sendSingleMessage(clearUserId, {
                    from: clearSessionId,
                    contentType: "image",
                    image: {
                        url: imageData.imageUrl,
                        text: imageData.fallbackText || imageData.imageAltText || ""
                    }
                });
            } else if (output.data?.template) {
                console.log("Found template data:");
                console.log(JSON.stringify(output.data.template, null, 2));
                
                return await sendSingleMessage(clearUserId, {
                    from: clearSessionId,
                    contentType: "template",
                    template: {
                        name: output.data.template.name,
                        language: output.data.template.language || "en",
                        text: output.data.template.text,  // Added text field
                        components: output.data.template.components || []
                    }
                });
            } else if (output.data?.quickReplies) {
                console.log("Found quick replies data:");
                console.log(JSON.stringify(output.data.quickReplies, null, 2));

                // Ensure required fields are present
                if (!output.data.quickReplies.text || !output.data.quickReplies.quickReplies?.length) {
                    console.error("Missing required fields for quick replies");
                    return null;
                }

                return await sendSingleMessage(clearUserId, {
                    from: clearSessionId,
                    contentType: "interactive",
                    interactive: {
                        type: "button",
                        // Optional header
                        ...(output.data.quickReplies.header && {
                            header: {
                                type: "text",
                                text: output.data.quickReplies.header
                            }
                        }),
                        // Required body
                        body: {
                            text: output.data.quickReplies.text
                        },
                        // Optional footer
                        ...(output.data.quickReplies.footer && {
                            footer: {
                                text: output.data.quickReplies.footer
                            }
                        }),
                        // Required action with buttons
                        action: {
                            buttons: output.data.quickReplies.quickReplies
                                .slice(0, 3)
                                .map((qr: any, index: number) => ({
                                    type: "reply",
                                    reply: {
                                        id: `option-${index + 1}`,
                                        title: qr.title
                                    }
                                }))
                        }
                    }
                });
            } else if (output.text) {
                console.log("Output has text property");
                return await sendSingleMessage(clearUserId, {
                    from: clearSessionId,
                    contentType: "text",
                    text: output.text
                });
            }

            console.error("Missing 8x8 compatible channel output!");
            return null;
        } catch (error) {
            console.error("Error in handleOutput:");
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
    console.log("Sending single message, content type:");
    console.log(message.contentType);
    console.log("Message content:");
    console.log(JSON.stringify(message, null, 2));

    const requestBody: any = {
        user: {
            msisdn: to  // This should already be in E.164 format
        },
        type: message.contentType
    };

    // Handle content based on message type
    switch (message.contentType) {
        case 'template':
            requestBody.content = {
                template: {
                    name: message.template.name,
                    language: message.template.language,
                    components: message.template.components || []
                }
            };
            break;
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
        case 'interactive':
            requestBody.content = {
                interactive: {
                    type: "button",
                    ...(message as I8x8InteractiveMessage).interactive
                }
            };
            break;
    }

    console.log("Constructed request body:");
    console.log(JSON.stringify(requestBody, null, 2));

    const webhookUrl = `${API_8X8_URL}/${SUB_ACCOUNT_ID}/messages`;

    console.log("Sending single message to 8x8 API");
    console.log("URL:");
    console.log(webhookUrl);
    console.log("Request Body:");
    console.log(JSON.stringify(requestBody, null, 2));

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
        
        console.log("8x8 API Response:");
        console.log(JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        console.error("Error in sendSingleMessage:");
        console.error(error);
        if (error.response) {
            console.error("Error response:");
            console.error(JSON.stringify(error.response.body, null, 2));
        }
        throw error;
    }
}

function hashString(str: string): string {
    return crypto.createHash(HASH_ALGORITHM).update(str).digest('hex');
}

// Update debugLog function
function debugLog(message: string, data?: any) {
    console.log(`[8x8 Webhook] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}
