export function createGenerationCoordinator() {
    const activeKeys = new Set();

    return {
        async run(key, operation) {
            if (activeKeys.has(key)) {
                throw new Error('Image generation is already in progress for this target.');
            }
            activeKeys.add(key);
            try {
                return await operation();
            } finally {
                activeKeys.delete(key);
            }
        },
    };
}
