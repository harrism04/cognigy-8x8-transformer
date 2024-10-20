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

interface I8x8MediaMessage extends I8x8MessageBase {
    contentType: 'Image' | 'Audio' | 'Video';
    url: string;
    text?: string;
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

type T8x8Content = I8x8TextMessage | I8x8MediaMessage | I8x8TemplateMessage | I8x8InteractiveMessage;

/**
 * Converts Cognigy output to 8x8 format
 */
function convertCognigyTo8x8(processedOutput: any, sessionId: string): T8x8Content[] {
    const messages: T8x8Content[] = [];

    for (const output of processedOutput.outputStack) {
        if (output.text && !output.data?._cognigy?._default) {
            messages.push({
                from: sessionId,
                contentType: "text",
                text: output.text
            });
        } else if (output.data?._cognigy?._default) {
            const defaultContent = output.data._cognigy._default;

            if (defaultContent._image) {
                messages.push({
                    from: sessionId,
                    contentType: "Image",
                    url: defaultContent._image.imageUrl,
                    text: defaultContent._image.fallbackText || ""
                });
            } else if (defaultContent._audio) {
                messages.push({
                    from: sessionId,
                    contentType: "Audio",
                    url: defaultContent._audio.audioUrl
                });
            } else if (defaultContent._video) {
                messages.push({
                    from: sessionId,
                    contentType: "Video",
                    url: defaultContent._video.videoUrl,
                    text: defaultContent._video.fallbackText || ""
                });
            } else if (defaultContent._quickReplies) {
                messages.push(convertQuickRepliesTo8x8Interactive(defaultContent._quickReplies, sessionId));
            }
        }
    }

    return messages;
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

/**
 * Sends a single message using 8x8 Messaging API
 */
async function sendSingleMessage(subAccountId: string, to: string, message: T8x8Content) {
    const requestBody: any = {
        user: {
            msisdn: to  // Make sure 'to' includes the '+' prefix
        },
        type: message.contentType,
        content: {}
    };

    switch (message.contentType) {
        case 'text':
            requestBody.content = { text: (message as I8x8TextMessage).text };
            break;
        case 'Image':
        case 'Video':
            requestBody.content = {
                url: (message as I8x8MediaMessage).url,
                text: (message as I8x8MediaMessage).text
            };
            break;
        case 'Audio':
            requestBody.content = {
                url: (message as I8x8MediaMessage).url
            };
            break;
        case 'template':
            requestBody.content = { template: (message as I8x8TemplateMessage).template };
            break;
        case 'interactive':
            requestBody.content = (message as I8x8InteractiveMessage).interactive;
            break;
    }

    try {
        const response = await httpRequest({
            uri: `${API_8X8_URL}/${subAccountId}/messages`,
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
        console.error(`Error in sendSingleMessage: ${error}`);
        throw error;
    }
}

/**
 * Sends batch messages using 8x8 Messaging API
 */
async function sendBatchMessages(subAccountId: string, to: string, messages: T8x8Content[]) {
    const requestBody = {
        messages: messages.map(message => ({
            user: {
                msisdn: to  // Make sure 'to' includes the '+' prefix
            },
            type: message.contentType,
            content: {}
        }))
    };

    requestBody.messages.forEach((msg, index) => {
        switch (messages[index].contentType) {
            case 'text':
                msg.content = { text: (messages[index] as I8x8TextMessage).text };
                break;
            case 'Image':
            case 'Video':
                msg.content = {
                    url: (messages[index] as I8x8MediaMessage).url,
                    text: (messages[index] as I8x8MediaMessage).text
                };
                break;
            case 'Audio':
                msg.content = {
                    url: (messages[index] as I8x8MediaMessage).url
                };
                break;
            case 'template':
                msg.content = { template: (messages[index] as I8x8TemplateMessage).template };
                break;
            case 'interactive':
                msg.content = (messages[index] as I8x8InteractiveMessage).interactive;
                break;
        }
    });

    try {
        const response = await httpRequest({
            uri: `${API_8X8_URL}/${subAccountId}/messages/batch`,
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
        console.error(`Error in sendBatchMessages: ${error}`);
        throw error;
    }
}

/**
 * Hashes a string using the specified algorithm
 */
function hashString(str: string): string {
    return crypto.createHash(HASH_ALGORITHM).update(str).digest('hex');
}

createRestTransformer({ 
    handleInput: async ({ endpoint, request, response }) => {
        console.log(`Incoming request body: ${JSON.stringify(request.body, null, 2)}`);

        // handle accepted 8x8 WhatsApp messages
        if (request.body.eventType !== "inbound_message_received") {
            response.sendStatus(200);
            return;
        }

        const currentTime = Date.now();
        const clearUserId = request.body.payload.user.msisdn;
        const clearSessionId = request.body.payload.recipient.channelId;

        if (!clearUserId || !clearSessionId) {
            console.error(`Missing userId or sessionId in incoming message: ${JSON.stringify({
                clearUserId,
                clearSessionId,
                payload: request.body.payload
            }, null, 2)}`);
            response.status(400).json({ error: "Missing userId or sessionId" });
            return;
        }

        let userId = clearUserId;
        let sessionId = clearSessionId;

        if (HIDE_USER_ID) {
            userId = hashString(userId);
        }
        if (HIDE_SESSION_ID) {
            sessionId = hashString(sessionId);
        }

        const sessionStorage = await getSessionStorage(userId, sessionId);

        if (sessionStorage.timestamp) {
            const difference = currentTime - sessionStorage.timestamp;
            if (SESSION_TIMEOUT && (difference > SESSION_TIMEOUT * 1000)) {
                sessionStorage.timestamp = currentTime;
            }
        } else {
            sessionStorage.timestamp = currentTime;
        }

        sessionStorage.clearUserId = clearUserId;
        sessionStorage.clearSessionId = clearSessionId;

        let text = request.body.payload.content.text;
        const data = request.body.payload;

        console.log(`Processed input: ${JSON.stringify({ userId, sessionId, text }, null, 2)}`);

        return {
            userId,
            sessionId,
            text,
            data,
        };
    },

    handleOutput: async ({ output }) => {
        return output;
    },

    handleExecutionFinished: async ({ processedOutput, userId, sessionId }) => {
        const sessionStorage = await getSessionStorage(userId, sessionId);
        const clearUserId = sessionStorage.clearUserId;
        const clearSessionId = sessionStorage.clearSessionId;

        const messages: T8x8Content[] = convertCognigyTo8x8(processedOutput, clearSessionId);

        if (!messages.length) {
            console.error("Missing 8x8 compatible channel output!");
            return;
        }

        if (messages.length === 1) {
            return await sendSingleMessage(SUB_ACCOUNT_ID, clearUserId, messages[0]);
        } else {
            return await sendBatchMessages(SUB_ACCOUNT_ID, clearUserId, messages);
        }
    } 
});
