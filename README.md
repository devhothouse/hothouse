# Hothouse

A local-first, open-source AI dating simulation sandbox. Create a profile, swipe through AI characters, match, and chat — while those characters also discover, match, and talk with each other in a simulated social network of their own.

Everything runs on your own machine, using your own API keys.

---

## ⚠️ Content Advisory

**This application is intended for adults (18+) only.** It can generate sexually explicit content, nudity, and mature themes. By installing or using Hothouse you confirm you are of legal age in your jurisdiction.

## Features

- **Swipe feed & matching** — swipe through AI characters; mutual likes match (with optional match delays), and characters can message you on their own initiative.
- **Live chat** — conversational roleplay with configurable reply behavior, message editing, unmatching, image attachments, and click-to-expand images.
- **AI characters that live their own lives** — characters evaluate, match, and converse with *each other*; a community gossip board reacts to how they treat you.
- **Personalized generation** — characters are generated to fit your demonstrated preferences, with per-gender tag lists and fully editable prompts.
- **AI image generation** — characters can get AI-generated portraits and share generated images in chat (bring your own provider or use the keyless default; off by default).
- **Text-to-speech** — six TTS provider options, with an AI voice picker that assigns fitting voices automatically.
- **Multi-provider LLM support** — Google Gemini, Anthropic, OpenRouter, any OpenAI-compatible endpoint, or a local/self-hosted model (Ollama, LM Studio, llama.cpp, vLLM, KoboldCpp, LocalAI), with per-task model routing and failover.
- **Full control** — every prompt, parameter, and provider is editable in the Manager tab. Settings export/import and in-app snapshots included.
- **Portable characters** — export/import any character as a single JSON file, portrait included.
- **One-click launcher** — double-click to run; closing the window stops the app.

## Requirements

- [Node.js](https://nodejs.org/) **20 or newer**
- An API key for at least one LLM provider — or a local model server, which needs no key at all
- Optional: an API key for a TTS provider (ElevenLabs, OpenAI-compatible, Google Cloud, Cartesia, Fish Audio, or a custom bridge)

## Getting Started

1. **Get the app** — download the zip from the Releases page, or clone this repository.
2. **Launch it** —
   - Windows: double-click **`Launch Hothouse.bat`**
   - macOS / Linux: run **`./launch-hothouse.sh`**

   Windows may show a security note the first time you run the launcher. That is expected for unsigned open-source software — click **More info → Run anyway** (the launcher is a plain script you can read).

   The first launch takes a few minutes (installs dependencies, prepares the database, builds the app). After that, starts are fast. If Node.js isn't installed yet, the launcher will say so and point you to the download.
3. **Set it up** — the app opens at `http://127.0.0.1:3000`. Click **Set up Hothouse** in the top bar and follow the guided wizard: content acknowledgement, model provider and API key (with a connection test), optional voice, and starter characters.
4. **Create a profile and start swiping.**

### Optional launch settings

Create a `launch-settings.json` file next to the launcher to customize:

```json
{ "openIncognito": false, "port": 3000 }
```

## Privacy

Hothouse is fully local. There are no accounts, no telemetry, and no analytics. Your API keys and data stay on your machine. The only network traffic is direct calls to the providers you configure yourself.

## Costs

You bring your own API keys, and provider usage is billed by the provider. Chatting is cheap; background features (character generation, portraits, social-network simulation rounds) consume additional tokens. Everything is configurable or switchable off in the Manager tab.

## Troubleshooting

| Problem | Fix |
|---|---|
| Windows security warning when running the launcher | Expected for unsigned open-source apps. Click **More info → Run anyway**. |
| "Something is already running on port 3000" | Close the other Hothouse window, or set a different `port` in `launch-settings.json`. |
| Node version error | Install Node.js 20+ from [nodejs.org](https://nodejs.org/) and relaunch. |
| Browser didn't open | Open `http://127.0.0.1:3000` manually. |
| App won't start after an update | Delete the `.next` folder and relaunch to force a rebuild. |
| App feels stuck | Close the launcher window (this always stops the app) and start it again. |

## Support & Feedback

- **Buy Me a Coffee:** [buymeacoffee.com/hothouse](https://buymeacoffee.com/hothouse)
- **Feedback & info:** [hothousedev.carrd.co](https://hothousedev.carrd.co/)
- **Source code:** [github.com/devhothouse/hothouse](https://github.com/devhothouse/hothouse)

Hothouse is open-source and will always be free. If it was worth your time, please consider tipping the barman :)

## License

Released under the [GNU GPL-3.0 license](LICENSE).

## Built With

[Next.js](https://nextjs.org/) · [React](https://react.dev/) · [Prisma](https://www.prisma.io/) + SQLite · [Tailwind CSS](https://tailwindcss.com/) · [Framer Motion](https://motion.dev/) · [Lucide](https://lucide.dev/)