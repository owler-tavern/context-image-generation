import test from 'node:test';
import assert from 'node:assert/strict';

import {
    decideImageNavigation,
    handleImageGesture,
    navigationDirectionForGesture,
} from '../lib/rp/image-navigation.js';

test('previous from the first image stays at the first image', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'previous', currentIndex: 0, mediaLength: 3, generatePastLast: true, generationActive: false,
    }), { action: 'stay', index: 0, reason: 'at-first-image' });
});

test('previous from a middle image navigates to the preceding existing image', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'previous', currentIndex: 2, mediaLength: 4, generatePastLast: true, generationActive: false,
    }), { action: 'navigate', index: 1 });
});

test('next with a later existing image navigates without generation', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 1, mediaLength: 4, generatePastLast: true, generationActive: false,
    }), { action: 'navigate', index: 2 });
});

test('next at the newest image generates when overswipe generation is enabled', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 2, mediaLength: 3, generatePastLast: true, generationActive: false,
    }), { action: 'generate' });
});

test('next at the newest image stays put when overswipe generation is disabled', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 2, mediaLength: 3, generatePastLast: false, generationActive: false,
    }), { action: 'stay', index: 2, reason: 'generation-disabled' });
});

test('busy generation takes precedence over the overswipe setting', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 2, mediaLength: 3, generatePastLast: true, generationActive: true,
    }), { action: 'stay', index: 2, reason: 'generation-active' });
});

test('single-image boundaries never wrap', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'previous', currentIndex: 0, mediaLength: 1, generatePastLast: true, generationActive: false,
    }), { action: 'stay', index: 0, reason: 'at-first-image' });
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 0, mediaLength: 1, generatePastLast: false, generationActive: false,
    }), { action: 'stay', index: 0, reason: 'generation-disabled' });
});

test('invalid or empty media is ignored', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 0, mediaLength: 0, generatePastLast: true, generationActive: false,
    }), { action: 'ignore', reason: 'no-media' });
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 0, mediaLength: '3', generatePastLast: true, generationActive: false,
    }), { action: 'ignore', reason: 'invalid-media-length' });
});

test('numeric index bounds are normalized before navigation', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'next', currentIndex: 99, mediaLength: 3, generatePastLast: false, generationActive: false,
    }), { action: 'stay', index: 2, reason: 'generation-disabled' });
    assert.deepEqual(decideImageNavigation({
        direction: 'previous', currentIndex: -4, mediaLength: 3, generatePastLast: false, generationActive: false,
    }), { action: 'stay', index: 0, reason: 'at-first-image' });
});

test('unknown directions are ignored', () => {
    assert.deepEqual(decideImageNavigation({
        direction: 'up', currentIndex: 0, mediaLength: 3, generatePastLast: true, generationActive: false,
    }), { action: 'ignore', reason: 'invalid-direction' });
});

test('touch swipe directions map to image navigation directions', () => {
    assert.equal(navigationDirectionForGesture('swiped-left'), 'next');
    assert.equal(navigationDirectionForGesture('swiped-right'), 'previous');
    assert.equal(navigationDirectionForGesture('swiped-up'), null);
});

function gestureEvent(type) {
    return {
        type,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
    };
}

test('recognized image gestures consume the event and activate the matching native arrow once', () => {
    const event = gestureEvent('swiped-left');
    let activations = 0;
    const arrow = { click: () => { activations += 1; } };

    assert.equal(handleImageGesture({
        event,
        gesturesEnabled: true,
        resolveArrow: (direction) => direction === 'next' ? arrow : null,
    }), true);
    assert.equal(activations, 1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
});

test('disabled gestures, missing arrows, and unrelated events remain untouched', () => {
    const disabled = gestureEvent('swiped-right');
    const missingArrow = gestureEvent('swiped-left');
    const unrelated = gestureEvent('swiped-up');
    let activations = 0;
    const arrow = { click: () => { activations += 1; } };

    assert.equal(handleImageGesture({ event: disabled, gesturesEnabled: false, resolveArrow: () => arrow }), false);
    assert.equal(handleImageGesture({ event: missingArrow, gesturesEnabled: true, resolveArrow: () => null }), false);
    assert.equal(handleImageGesture({ event: unrelated, gesturesEnabled: true, resolveArrow: () => arrow }), false);
    assert.equal(activations, 0);
    for (const event of [disabled, missingArrow, unrelated]) {
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.propagationStopped, false);
    }
});
