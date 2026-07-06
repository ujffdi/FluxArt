# Limit V1 model administration fields

FluxArt V1 Model Administration will expose only execution mode, provider, model name, base URL, API key secret reference, and request timeout. It will not store plaintext provider keys, arbitrary request templates, pricing rules, or credit-spend policy in this page, because the immediate goal is safe operational model switching rather than building a full provider-integration console.
