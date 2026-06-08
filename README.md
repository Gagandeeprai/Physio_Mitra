# Physio Mitra (PhysioAI)

AI-powered physiotherapy assistant with a web UI, real-time pose tracking, repetition counting, and live form feedback for:

- Squats
- Sit-to-Stand (STS)
- Lunges
- Shoulder Abduction

## Tech Stack

- **Frontend/UI:** HTML, CSS, Vanilla JavaScript (`/public`)
- **Server:** Node.js + Express + Socket.IO (`server.js`)
- **Pose/Exercise Engine:** Python + OpenCV + MediaPipe (`backend.py`)

## Prerequisites

- Node.js 18+ (recommended)
- Python 3.9+
- Webcam access
- `pose_landmarker_full.task` present in the project root (already included)

Python packages required by `backend.py`:

- `opencv-python`
- `mediapipe`
- `numpy`
- `pyttsx3`
- `pywin32` (needed for `pythoncom`, mainly on Windows)

## Installation

1. Clone and open the repository.
2. Install Node dependencies:

   ```bash
   npm install
   ```

3. Install Python dependencies:

   ```bash
   pip install opencv-python mediapipe numpy pyttsx3 pywin32
   ```

## Run the App

### Option A: Windows helper script

```bat
start_physio.bat
```

### Option B: Manual

```bash
npm start
```

Then open: `http://localhost:3000`

## How It Works

1. Browser connects to Node.js via Socket.IO.
2. Node.js spawns `backend.py` as a background process.
3. Python reads webcam frames, runs pose detection, and computes exercise metrics.
4. Python streams JSON events (status/frame/session updates) to Node.js.
5. Node.js relays those events to the UI in real time.

## Basic Usage

1. Open the setup screen.
2. Select exercise mode, reps, and sets.
3. Enable camera.
4. Start session and follow live feedback.
5. Use stop/next set controls as needed.

## Project Structure

```text
.
├── backend.py                  # Pose detection + exercise analysis engine
├── server.js                   # Express + Socket.IO bridge to Python process
├── pose_landmarker_full.task   # MediaPipe pose model asset
├── public/
│   ├── index.html              # UI layout
│   ├── app.js                  # Frontend session logic
│   ├── style.css               # UI styling
│   └── images/                 # Exercise illustrations
├── package.json
└── start_physio.bat            # Windows startup helper
```

## Notes

- The default `npm test` script is currently a placeholder and exits with an error by design.
- Voice cues are generated in Python using `pyttsx3`.
