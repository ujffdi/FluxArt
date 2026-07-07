const secretValuePatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g
];

const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function redactSecretValues(value: string) {
  return secretValuePatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "sk-...[redacted]"),
    value
  );
}

export function looksLikeSecretValue(value: string) {
  return secretValuePatterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function isEnvironmentSecretRef(value: string) {
  return environmentVariableNamePattern.test(value);
}

export function liveSecretRefProblem(value: string) {
  if (looksLikeSecretValue(value)) {
    return "apiKeySecretRef must be an environment variable name that contains the API key, not the API key value";
  }
  if (!isEnvironmentSecretRef(value)) {
    return "apiKeySecretRef must be an environment variable name like FLUXART_IMAGE_API_KEY for live image generation";
  }
  return undefined;
}
