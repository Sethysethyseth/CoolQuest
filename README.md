# CoolQuest

A multiplayer word-tracing duel for 1–8 players. It's a static website with no server to run. Multiplayer is peer-to-peer: the host's browser runs the game, and friends join with a 4-letter room code or invite link.

## Play locally
```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Then open http://localhost:8080.

## Play with friends (they need a public link)
Put this folder on any free static host. All of these work and need nothing installed:

- **Netlify Drop**: go to https://app.netlify.com/drop and drag the `spellcast` folder onto the page. You get a link like `https://something.netlify.app`.
- **GitHub Pages**: push the folder to a repo, then turn on Settings → Pages → Deploy from branch.
- **Cloudflare Pages**: use "Upload assets" and drop the folder.

Then:
1. Open the link, enter your name, and click **Create a room**.
2. Click **Copy invite link** and send it to your friends, or just tell them the code.
3. Once everyone shows up in the lobby, click **Begin the duel**.

## Notes
- If the **host** closes or refreshes their tab, the room ends. Anyone else can refresh and they'll rejoin automatically.
- Room connections are set up through the free PeerJS signaling service. After that, game traffic goes directly between browsers.
- Dictionary: the public-domain ENABLE word list (~172k words), stored in `words.js`.

## Rules in brief
- Drag across touching tiles (diagonals count) to spell a word. Each tile can be used once per word.
- Letter values are added up. **DL** doubles a letter, **TL** (final round) triples one, and **2×** doubles the whole word. Words of 6+ letters get **+10**.
- Crystal tiles give you crystals (max 10). Spend them on Shuffle (1), Swap a letter (3), or Hint (4).
- Everyone gets one word per round. The highest score after the last round wins.
