export function createOperationState() {
    let current = 0;

    return {
        begin() {
            current += 1;
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
