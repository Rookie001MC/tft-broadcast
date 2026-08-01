# HCMUSEC TFT Winner Graphic

HCMUSEC TFT Winner Graphic is an internal broadcast tool for VNUHCM - University of Science Esports Club, a student-run esports club, officially recognized by our University, used to display match winners during our own Teamfight Tactics tournament livestreams. It has a private control panel for our broadcast operator and a public on-stream graphic (OBS Browser Source / vMix) shown to our viewers.

After a tournament game ends, an operator clicks on an update button to query TFT-MATCH-V1 for our registered participants' Riot IDs, pulls their latest match placement, and shows it to the operator for manual confirmation before it airs - never automatically. ACCOUNT-V1 resolves each participant's Riot ID to a PUUID during roster setup.

Used only for our own club's tournaments, by our Production Team, private (for now, we can consider open source later), and never used to look up players outside our rosters. No real-time recommendations, no Legend/Augment win rates, no live client interaction - post-game results only.

APIs used: TFT-MATCH-V1, ACCOUNT-V1.

Tech Stack:
  - Frontend and Backend: SvelteKit v3
  - Database: SQLite (`better-sqlite3`), managed via Drizzle ORM
  - Styling: TailwindCSS, Skeleton UI
