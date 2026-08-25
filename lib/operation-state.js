export function createOperationState() {
    let current = 0;
    let sequence = 0;

    return {
        begin() {
            if (current !== 0) return null;
            sequence += 1;
            current = sequence;
            return current;
        },
        isCurrent(token) {
            return token === current;
        },
        finish(token) {
            if (token === current) current = 0;
        },
    };
}
