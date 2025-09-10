describe('json-secret-keys: selective key extraction', () => {
    it('Extracts only specified keys from JSON secret', () => {
        // These environment variables should be set by the GitHub Action workflow
        // when testing with json-secret-keys parameter
        expect(process.env.SELECTIVE_JSON_SECRET_API_KEY).not.toBeUndefined();
        expect(process.env.SELECTIVE_JSON_SECRET_DATABASE_PASSWORD).not.toBeUndefined();
        
        // These should NOT be set since they weren't specified in json-secret-keys
        expect(process.env.SELECTIVE_JSON_SECRET_API_USER).toBeUndefined();
        expect(process.env.SELECTIVE_JSON_SECRET_DATABASE_HOST).toBeUndefined();
        expect(process.env.SELECTIVE_JSON_SECRET_CONFIG_ACTIVE).toBeUndefined();
    });
    
    it('Falls back to all keys when json-secret-keys is not provided', () => {
        // These environment variables should be set by the GitHub Action workflow
        // when testing without json-secret-keys parameter (default behavior)
        expect(process.env.FALLBACK_JSON_SECRET_API_USER).not.toBeUndefined();
        expect(process.env.FALLBACK_JSON_SECRET_API_KEY).not.toBeUndefined();
        expect(process.env.FALLBACK_JSON_SECRET_DATABASE_HOST).not.toBeUndefined();
        expect(process.env.FALLBACK_JSON_SECRET_DATABASE_PASSWORD).not.toBeUndefined();
        expect(process.env.FALLBACK_JSON_SECRET_CONFIG_ACTIVE).not.toBeUndefined();
    });
});