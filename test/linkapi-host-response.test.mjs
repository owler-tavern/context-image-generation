import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchProviderRoute } from '../lib/providers/dispatch.js';
import { createGenerationPlan } from '../lib/generation-plan.js';
import { getModelDefinition } from '../lib/providers/registry.js';
const modelId = 'gemini-3.1-flash-image-preview';
const plan = createGenerationPlan({id:'host-response',invocation:'wand',resolved:{providerId:'linkapi',connectionId:'linkapi:default',modelId,transportId:'sillytavern-gemini-proxy',endpoint:'https://api.linkapi.ai',modelDefinition:getModelDefinition('linkapi',modelId)},prompt:{sourceMessage:'A blue cup'},policy:{source:'manual'}});
async function run(body) {
 return dispatchProviderRoute({plan,signal:new AbortController().signal,connection:{id:'linkapi:default',providerId:'linkapi',enabled:true},transportContext:{apiKey:'fixture',fetchImpl:async()=>new Response(JSON.stringify(body),{status:200})}});
}
test('HTTP 200 host errors retain the actual blocked reason and LinkAPI attribution',async()=>{
 await assert.rejects(run({error:{message:'MakerSuite API returned no candidate. Prompt was blocked due to SAFETY'}}),e=>{
  assert.equal(e.providerId,'linkapi');assert.equal(e.modelId,modelId);assert.equal(e.category,'content_policy');assert.match(e.technicalMessage,/no candidate/);return true;
 });
});
test('unknown HTTP 200 host errors remain provider errors instead of claiming completion',async()=>{
 await assert.rejects(run({error:{message:'MakerSuite Candidate text empty'}}),e=>{
  assert.equal(e.providerId,'linkapi');assert.equal(e.category,'provider_response');assert.match(e.userMessage,/Candidate text empty/);assert.doesNotMatch(e.userMessage,/completed|unknown completed/);return true;
 });
});
test('genuine text-only responses keep LinkAPI and model context without exposing generated text',async()=>{
 await assert.rejects(run({choices:[{message:{content:'PRIVATE GENERATED TEXT'}}],responseContent:{parts:[{text:'PRIVATE GENERATED TEXT'}]}}),e=>{
  assert.equal(e.providerId,'linkapi');assert.equal(e.category,'empty_result');assert.match(e.userMessage,/LinkAPI/);assert.doesNotMatch(JSON.stringify(e),/PRIVATE GENERATED TEXT/);return true;
 });
});
test('valid host inline image still decodes',async()=>{
 const result=await run({responseContent:{parts:[{inlineData:{mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'}}]}});
 assert.ok(result.imageData || result.data || result.base64);
});


test('host error details redact credentials before display and stay attributed after kernel normalization', async () => {
    const { attachNormalizedProviderError } = await import('../lib/providers/errors.js');
    await assert.rejects(run({ error: { message: 'Gateway failure Bearer fixture-credential-value' } }), error => {
        const normalized = attachNormalizedProviderError(error, { providerId: error.providerId, modelId: error.modelId });
        assert.equal(normalized.providerId, 'linkapi');
        assert.equal(normalized.modelId, modelId);
        assert.doesNotMatch(normalized.userMessage, /fixture-credential-value/);
        assert.match(normalized.userMessage, /redacted/);
        return true;
    });
});
