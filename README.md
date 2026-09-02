# Context Image Generation

A SillyTavern extension that turns roleplay moments into scene images using chat context, character details, and optional avatar references.

For provider routing, maintenance guidance, security boundaries, and verification, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

Provider availability and evidence status are tracked in [docs/PROVIDER_CATALOG.md](docs/PROVIDER_CATALOG.md). TokenReply and the additional hosted profiles are currently experimental until live evidence is recorded.

> **Fork notice** — This is a fork of [elouannd/context-image-generation](https://github.com/elouannd/context-image-generation) by **Elouann**. It was forked to add **LinkAPI provider support** (routing image generation through LinkAPI's Gemini-compatible endpoint) without changing your active SillyTavern Chat Completion profile. All credit for the original extension goes to Elouann; the original is released into the public domain under The Unlicense.

> **Development note** — This fork is maintained by **BlueOwler** with AI-assisted development using **OpenAI Codex**, with manual direction and review.

## v2.5 scope

- **Two generation entry points:** use the message wand for a chat attachment or `/proimagine` (plus `/proimg` and `/geminiimg`) for preview/Gallery delivery. Both use the same generation path.
- **Configuration-only Settings:** choose the provider, model, scene preferences, and optional avatar, previous-image, or saved-appearance references. Settings actions, including **Refresh Models**, never generate an image.
- **Provider-free story tools:** Cinematic suggestions, Story Memory, Gallery, Improve tools, and saved appearances can stage context for the next wand or slash command, but cannot start generation themselves.
- **Inert legacy data:** attire remains prompt/scene content. Retired outfit controls, automatic generation, generate-on-swipe, iteration dispatch, and Director dispatch are not exposed; existing legacy outfit data is retained for rollback.

## Historical fork changes (v1.7.1)

- **Single avatar-reference toggle restored** - The character and persona avatars are once again enabled together with one **Use avatar references** setting. Existing split preferences migrate automatically: either prior setting enabled becomes the combined setting enabled.

## Provider adapters and recovery

- **LinkAPI** keeps its existing Gemini-compatible and OpenAI Images model routes behind provider adapters. This does not change your active SillyTavern Chat Completion profile.
- **TokenReply (Experimental)** provides the text-only `grok-imagine-image` and `grok-imagine-image-quality` profiles. It sends a minimal request until a live compatibility test confirms TokenReply's supported image-size/resolution field and response format.
- **Hosted provider wave 1 (Experimental):** registry-driven OpenAI GPT Image, Pollinations paid JSON, NanoGPT, Together AI, Routeway, and Navy.ai profiles reuse the validated OpenAI Images transport. Optional capabilities remain disabled unless the selected model's evidence explicitly supports them.
- **Hosted provider catalog:** Z.AI and ArliAI have dedicated Experimental native adapters with curated built-in models; async/binary/conflicting/chute-specific profiles such as Chutes, Fal.ai, Replicate, CivitAI, PixAI, Kie.ai, Midjourney/LegNext, NovelAI, Stability AI, and Naistera remain unavailable Future Server records.
- **Manual LinkAPI recovery:** in LinkAPI's **Advanced** settings, **Use legacy LinkAPI routing** lets you deliberately retry using the pre-adapter request path. It is never automatic, so a failed normal request will not make an unrequested second paid generation.

### Direct-provider troubleshooting

Direct LinkAPI Images and TokenReply requests run in the browser. Use browser DevTools (**F12**): enable **Preserve log**, inspect **Console** for [context-image-generation] OpenAI Images error (HTTP status), and inspect **Network** for images/generations. Do not share the Authorization header or API key. Gemini/SillyTavern-routed request logs appear in the SillyTavern server console.
## What's New in this Fork (v1.7.0)

- **Lighter gallery** - Gallery images are now stored as files (only paths are
  kept in settings), instead of full-resolution base64 embedded in
  `settings.json`. This dramatically shrinks the settings file and speeds up
  saves and startup. Existing base64 gallery items keep displaying; new ones use
  files. Inline chat images are unaffected (they already used files). Prompt text
  in the gallery is now safely escaped.

## Historical fork changes (v1.6.0)

- **Regenerate on image swipe** (historical) - This behavior was introduced in
  v1.6.0 and is retired in v2.5; image navigation now stays navigation-only.

## What's New in this Fork (v1.5.0)

- **ChatGPT image models** - Generate images with OpenAI `gpt-image` models
  (e.g. `gpt-image-2-c`) through your LinkAPI account. Text-prompt only
  (character/user descriptions are included; avatar image references are not
  supported for these models). Optional "Fetch models" button lists the
  `gpt-image*`/`dall-e*` models available on your key.

## What's New in this Fork (v1.4.0)

- **LinkAPI Provider** - Added LinkAPI as a provider option. Enter a LinkAPI key (used only for image generation) and requests are routed through `https://api.linkapi.ai` without touching your active Chat Completion proxy settings.

## Historical fork changes (v1.3.3)

- **Auto Generate** (historical) - This behavior was introduced in v1.3.3 and
  is retired in v2.5; messages never trigger an unrequested provider call.

## What's New in v1.3.2

- **Thinking Level** - Control how much the model "thinks" before generating (Auto, Minimal, Low, Medium, High) — Flash 2 only
- **Google Search** - Let the model search the web for reference images and information before generating — Flash 2 only (may not work on OpenRouter)
- **Updated System Prompt** - Default prompt now mentions internet search capabilities

## What's New in v1.3.1

- **Expanded Image Sizes** - Added support for 512px to 4K resolutions for Nano Banana 2 (Flash)

## What's New in v1.3.0

- **Nano Banana 2 (Flash)** - Added `gemini-3.1-flash-image-preview` as a new model option

## What's New in v1.2

- **Provider Selection** - Choose between Google AI Studio or OpenRouter
- **4K Image Support** - Generate 4K images with Gemini 3 Pro
- **Dynamic Model List** - Models update automatically based on selected provider

## What's New in v1.1

- **Message Depth** - Include 1-10 previous messages as story context for better scene understanding
- **Previous Image Reference** - Use last generated image as style reference for consistency
- **File-Based Storage** - Images saved to files instead of base64 in chat logs

## Features

- **Message Generation Button** - Wand icon in the dropdown menu on each message to generate an image from that message's content
- **Character Context** - Automatically includes character and user descriptions in prompts
- **Avatar References** - Uses character and user avatars as visual references for consistent art
- **Slash Command** - `/proimagine <prompt>` for quick generation
- **Optional appearance memory** - Remember a generated look for later wand or slash context without making it required.

## Requirements

- SillyTavern (latest staging branch).
- **Google AI Studio or OpenRouter:** configure the selected provider and its image-capable model in SillyTavern Chat Completion settings. Google AI Studio and OpenRouter use SillyTavern Chat Completion settings; this extension does not ask for a separate key for either route.
- **LinkAPI Gemini models:** select LinkAPI in this extension and enter a LinkAPI key under Provider API Key. LinkAPI Gemini models use the SillyTavern route with a request-scoped LinkAPI proxy, without changing the active Chat Completion profile.
- **LinkAPI `gpt-image*`/`dall-e*` models:** select LinkAPI and enter the same LinkAPI key. LinkAPI `gpt-image*`/`dall-e*` models use LinkAPI's direct Images route; they are text-only, and **Manage models → Fetch models** can discover matching image IDs.
- **TokenReply `grok-imagine-image` (Experimental):** select TokenReply and enter a TokenReply key under Provider API Key. TokenReply is Experimental and text-only; it has two built-in models (`grok-imagine-image` and `grok-imagine-image-quality`), experimental **Manage models → Fetch models** support, no reference-image controls, and no image-size control until a live test verifies its contract.
- **Wave 1 hosted profiles (Experimental):** select OpenAI GPT Image, Pollinations, NanoGPT, Together AI, Routeway, or Navy.ai and enter that provider's key. They use HTTPS Bearer-authenticated Images routes; references and optional size controls remain hidden until route/model evidence enables them.
- **Native hosted profiles (Experimental):** select Z.AI or ArliAI and enter that provider's key. These use dedicated HTTPS Bearer-authenticated native routes with curated built-in models; references and editing remain disabled or unknown until route/model evidence enables them. Chutes remains Future Server because its model routes are chute-specific.

## Installation

1. In SillyTavern, open **Extensions** and install this repository.
2. Open Context Image Generation's settings.
3. Choose one route: configure Google AI Studio/OpenRouter in SillyTavern Chat Completion settings, or choose a direct hosted profile and enter that provider's key in the extension. Future Server Adapter entries are unavailable.
4. Select a model appropriate to that route, then generate from the message wand or `/proimagine`.

## Usage

### Message Button
1. Open a chat with a character
2. Click the "..." menu on any message
3. Click the wand icon (✨) to generate an image from that message

You can select a passage inside the rendered message before clicking its wand. A non-empty selection up to 600 characters becomes the primary visual moment while the surrounding message context remains available for continuity. Selections outside that message, or selections longer than the limit, fall back to the normal whole-message generation.

### Settings Panel

- Select Google AI Studio or OpenRouter to use the active SillyTavern Chat Completion configuration.
- Select LinkAPI to enter a LinkAPI key, choose Gemini or direct Images models, and manage or fetch additional `gpt-image*`/`dall-e*` models.
- Select TokenReply (Experimental) to enter its separate key and choose `grok-imagine-image` or `grok-imagine-image-quality`; it is text-only and hides image-size and reference-image controls.
- Choose aspect ratio and compatible controls for the selected model, toggle descriptions, customize the system instruction, and manage the gallery. Settings is configuration-only; the wand and slash command are the generation actions.
- Use **Refresh Models** beside Setup → Model to check the selected provider. Existing local model IDs are kept when discovery is empty or fails.
- Use **Manage models** to add or edit the actual model ID sent to the selected provider. **Fetch models** merges discovered IDs without deleting your local entries. TokenReply discovery is Experimental and may fail safely until its /v1/models behavior is live-verified.
- For a manual or fetched model whose image-generation capability is unknown, open **Manage models** and explicitly enable **Allow experimental text-only generation** after reviewing the warning. Optional features stay disabled, and generation remains blocked until this confirmation is present.

### Slash Command
```
/proimagine a beautiful sunset over mountains
```
Aliases: `/proimg`, `/geminiimg`

## Configuration

| Setting | Route-specific behavior |
|---------|-------------------------|
| Provider | Google AI Studio/OpenRouter use SillyTavern Chat Completion settings; LinkAPI and TokenReply use a key entered in this extension. |
| Provider API Key | Registry-driven for LinkAPI, TokenReply, OpenAI GPT Image, Pollinations, NanoGPT, Together AI, Routeway, and Navy.ai; each provider retains its own credential association. |
| Model | Gemini controls apply to Gemini models. Direct Wave 1 Images profiles remain text-only with unknown optional capabilities unless model evidence enables them. |
| Fetch models | LinkAPI/TokenReply use OpenAI-list discovery; Pollinations uses `/image/models`; NanoGPT uses `/api/v1/image-models?detailed=true`; Routeway filters explicit image-output metadata from `/v1/models`; OpenAI/Together/Navy use curated IDs. Failed fetches leave local IDs unchanged. |
| Aspect ratio / image size | Gemini-compatible controls retain their model-specific behavior. TokenReply hides image size until live verification confirms its accepted field. |
| Avatar / previous-image references | Available only to models whose provider metadata supports reference images; hidden for TokenReply and direct LinkAPI Images models. |
| LinkAPI recovery | Advanced, manual-only legacy-routing switch; never an automatic fallback. |
| Thinking Level | Flash 2 only: Auto, Minimal, Low, Medium, High. |
| Google Search | Flash 2 only: Enable web search for references. |
| Generation actions | Message wand attaches to the captured message; `/proimagine` and its aliases deliver to preview/Gallery. |
| Message Depth | Number of messages to include as context (1-10). |
| Image navigation | Previous/next navigation only; swiping never starts generation. |
| Include Descriptions | Add character descriptions to the prompt. |
| System Instruction | Customize instructions for the image model. |

## Troubleshooting
- If a model refresh is empty or fails, existing local model IDs remain available. Check the selected provider and its credentials before trying **Refresh Models** again.
- No message event, image swipe, Story Memory action, cinematic suggestion, or Improve action starts a provider request. Use the message wand or `/proimagine` when you explicitly want to generate.


## To-Do

## License

This project is released into the public domain under [The Unlicense](LICENSE). You are free to use, modify, and distribute this code for any purpose, with or without attribution.

## Credits

- Original extension by **Elouann** — [elouannd/context-image-generation](https://github.com/elouannd/context-image-generation).
- LinkAPI provider support added in this fork by **BlueOwler**.
- Created for use with [SillyTavern](https://github.com/SillyTavern/SillyTavern).
- Provider architecture and UX research informed by [Pawtrait](https://github.com/ThatGirl-me/Pawtrait) and [Quick Image Gen](https://github.com/platberlitz/sillytavern-image-gen). No code was copied from either project.

### Provider hardening

When adding a manual model ID for a provider that has more than one route, select its route in **Manage models** before saving. TokenReply model fetching now keeps only `grok-imagine-image*` IDs. Repeating the same generation while it is in progress is blocked, preventing accidental duplicate paid requests.
