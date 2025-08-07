export default class ApiService {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    async query(payload) {
        try {
            const response = await fetch(
                "https://router.huggingface.co/v1/chat/completions", {
                    headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                    method: "POST",
                    body: JSON.stringify(payload)
                }
            );
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
            }
            return response;
        } catch (error) {
            console.error("Error al contactar la API:", error);
            throw error;
        }
    }
}