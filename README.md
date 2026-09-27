# Outbreak-24: Zombie Survival Map

**Outbreak-24** is a real-time, location-based multiplayer survival game built during a 33-hour hackathon sprint. Players are divided into "Humans" and "Zombies," using their real-world GPS locations to either survive the clock or hunt down the remaining survivors.

## The Concept
To survive, human players must stay on the move and avoid invisible "toxic paths" left behind by roaming zombies. To prevent hiding and camping, humans are forced to verify their surroundings every 10 minutes by uploading a quick 3-5 second video. If a player fails to upload, crosses a zombie's recent path, or walks out of the set boundaries, their location is exposed on the Zombie Tactical Map.

## Key Features
- **Dual UI Modes:** Humans get a tense, camera-first dashboard with a proximity heartbeat sensor. Zombies get a dark-mode tactical radar map to hunt players.
- **The "Toxic Path" Trap:** Using spatial database queries, if a human crosses an invisible GPS breadcrumb trail left by a zombie in the last 15 minutes, their location is immediately compromised.
- **Anti-Camping Protocol:** Players receive a prompt every 10 minutes to record a 5-second video of their surroundings. Videos appear as tappable clues on the Zombie map. 
- **Battle Royale Mechanics:** As the game progresses, the safe zone shrinks and the video ping frequency reduces, forcing a high-stakes endgame.
- **Infection Tag:** When a Zombie gets within 10 meters of a human, they can trigger an infection, immediately flipping the human's UI to join the Zombie horde.
- **Powerups:** Humans can use "Decoy Flares" (GPS spoofing) and "UV Blacklights" (temporary path reveals) to outsmart the horde.

## Tech Stack
This project is optimized for rapid deployment, real-time data, and geographical spatial math.
- **Frontend / Client:** React, Vite, Tailwind CSS, Framer Motion, Radix UI.
- **Maps & Routing:** Mapbox GL, Leaflet (React Native Maps).
- **Backend & Real-Time:** Supabase (BaaS) utilizing WebSockets for real-time map updates.
- **Spatial Queries:** PostgreSQL with **PostGIS** (`ST_DWithin` functions to calculate path intersections in real-time).
- **Tooling:** TypeScript, Zod, React Hook Form.

## Setup & Installation

### Prerequisites
- Node.js (v20+ recommended)
- A Supabase account / project setup
- Mapbox API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/varun-j1/outbreak-24.git](https://github.com/varun-j1/outbreak-24.git)
   cd outbreak-24

2. **Install dependencies:**
Note: If you run into a peer dependency conflict with Vite (e.g., v7 vs v5), use the legacy flag or downgrade Vite to v5 as per the hackathon setup.
```
npm install --legacy-peer-deps
# OR
npm install -D vite@^5.0.0
```

3. **Configure Environment Variables:**
Create a .env file in the root directory and add your keys:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_MAPBOX_TOKEN=your_mapbox_api_key
```

5. **Run the Development Server:**
`npm run dev`
