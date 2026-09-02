import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../settings.html', import.meta.url), 'utf8');

test('uses one avatar-reference setting while keeping legacy swipe generation inert', () => {
    assert.match(index, /use_avatars:\s*false/);
    assert.match(index, /if \(supportsReferenceImages && settings\.use_avatars\) \{/);
    assert.match(index, /cigSettings\.use_char_avatar \|\| cigSettings\.use_user_avatar/);
    assert.match(index, /delete cigSettings\.use_char_avatar/);
    assert.match(index, /delete cigSettings\.use_user_avatar/);
    assert.match(index, /regenerate_on_swipe:\s*false/);
    assert.doesNotMatch(index, /\$\('#cig_regenerate_on_swipe'\)/u);
    assert.doesNotMatch(settings, /id="cig_regenerate_on_swipe"/u);
    assert.match(settings, /id="cig_use_avatars"/);
    assert.match(index, /getReferenceImageCapability\(providerId, settings\.model\)/);
    assert.doesNotMatch(settings, /id="cig_use_char_avatar"/);
    assert.doesNotMatch(settings, /id="cig_use_user_avatar"/);
});
