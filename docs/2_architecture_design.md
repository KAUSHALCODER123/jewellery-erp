# System Architecture

## 1. Tech Stack
* **Application Shell:** Tauri (Desktop wrapper, lightweight).
* **Frontend UI:** React + Vite (Tailwind CSS for styling).
* **Backend / Local Server:** Node.js sidecar process running locally on the PC.
* **Database:** SQLite (local file, fully offline).
* **ORM:** Drizzle ORM (Type-safe database interactions).

## 2. System Flow
1.  **UI Layer:** React components render the interface.
2.  **Communication:** Frontend sends requests to the Node.js sidecar via local API calls or Tauri IPC commands.
3.  **Hardware Layer:** The Node.js sidecar uses `serialport` to maintain an open connection to the RS232 weighing scale and broadcast weights to the frontend via WebSockets or IPC events.
4.  **Data Layer:** Node.js executes Drizzle ORM queries against the local `sqlite.db` file.

## 3. Deployment Constraints
* **Single PC:** No LAN networking or cloud synchronization logic should be implemented for the core database.
* **Offline First:** The system must function at 100% capacity without an internet connection.
