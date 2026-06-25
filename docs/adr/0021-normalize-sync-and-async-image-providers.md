# Normalize sync and async image providers

FluxArt V1 will normalize both synchronous and asynchronous image providers into Provider Submission and Provider Result records. OpenAI image generation can return results synchronously, while other vendors may return an external task id and deliver results by polling or callback. Product logic should depend on FluxArt task states, not on one provider's response shape.
