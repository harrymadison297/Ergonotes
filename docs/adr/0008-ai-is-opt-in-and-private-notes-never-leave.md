# AI is opt-in, uses the person's own provider key, and private notes never reach it

*Amended by ADR 0015: the desktop apps now serve the MCP endpoint too, with the same private-note rule.*

Ergonotes is offline-first and keeps plaintext on the person's devices. An AI assistant is the first feature that sends
note text to a third party (OpenRouter or Anthropic), which is outside that promise. We add it as an explicit,
reversible exception with these rules, so the exception stays small and visible.

## Decision

- **Off until configured.** No request is made until the person saves a provider API key in *Settings → AI*. The
  next-words suggestion is a separate switch, off by default on every device, because each suggestion is a request.
- **The person's own keys, as many as they like.** There is no Ergonotes account or proxy of ours. The settings hold a
  list of *connections* (an OpenRouter or Anthropic key, or a server of the person's own), and two model choices, each
  naming a connection and a model: one for the chat, one for suggestions, so they may use different connections. They
  live in the Vault as an encrypted item (`type: config`, a fixed id) that syncs to the person's other Devices; keys are
  never returned by the API, so a browser only learns that a key exists and its last four characters.
- **A model of your own.** A third provider, *Custom server*, is any server that speaks the OpenAI chat API (Ollama,
  LM Studio, vLLM, LiteLLM): the person gives its address and, optionally, a key. Text then goes only where the person
  pointed it. The address is reached from the machine that makes the call: with the web build that is the Ergonotes
  server, so "localhost" is that machine, and only the signed-in owner can change the address.
- **Where the call is made.** A Device that holds the Vault calls the provider itself. In the web build the Server peer
  calls it (`/api/ai/stream`) so the key never reaches the browser.
- **What is sent.** By default the open Note and the conversation. "Let the assistant search and read all my notes" is a
  separate setting; the same tools are used by MCP agents.
- **Private notes.** A Note can be marked `private: true` (frontmatter, synced). Every tool, for the in-app chat and for
  the MCP endpoint alike, treats a private Note as not existing: it is not found by search, not listed, not readable and
  not writable. The editor's own suggestion and chat are also off for it. The owner still sees it everywhere in the app.
- **Thinking is a setting of the job, not of the model.** The chat and the suggestions each have their own level
  (Auto, Off, Low, Medium, High), also when they use the same model: suggestions default to Off. The model's thinking is
  shown in the chat; for Anthropic the signed thoughts are kept with the answer because the API needs them back.
- **Edits are proposals.** The assistant's changes to a Note are shown as a diff that the person accepts or rejects; an
  accepted change goes through the editor like typing and is therefore an ordinary Commit. "Apply without asking" is a
  setting. There is no delete tool.
- **Attachments are explicit.** The person can attach notes and files to a message (`@`, `+`); only those are added to
  the prompt, whatever the "all my notes" setting says. A private note cannot be attached. A file from the device is read
  in the app and sent with the message; it is not stored.
- **Ask or Edit.** In Ask mode the assistant has no tool that creates or changes anything.
- **Conversations are kept in the Vault** as encrypted `chat` items (never listed as notes), so each Device has the same
  history. They hold what was sent to the provider, including attached text; deleting a conversation purges the item.
  Proposals that were still open when it was saved come back as "Not applied".

## Consequences

- Anyone who can unlock the Vault can read the provider key, as with the Store credentials today (ADR 0004).
- Text of non-private notes leaves the device when the assistant is used: the person is told so in the settings page.
- The MCP endpoint's behaviour changed: private notes disappeared from it. Agents that were told about a note by id
  get "Note not found".
- Two Devices saving the AI settings at once are settled automatically (newest wins) instead of opening a conflict.
- A model that cannot call tools can chat but cannot edit; the model name is free text so the person decides.
