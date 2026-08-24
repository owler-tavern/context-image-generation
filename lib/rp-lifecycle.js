export function createChatLifecycleEpoch() {
    let epoch = 0;

    return {
        advance() {
            epoch += 1;
            return epoch;
        },
        capture() {
            return epoch;
        },
        isCurrent(captured) {
            return captured === epoch;
        },
    };
}
