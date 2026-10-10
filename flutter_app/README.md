# Track2College Flutter app

A Flutter client for the FastAPI service in `../Track2Cllg/api.py`. The app supports the `/chat` conversation endpoint, displays returned source URLs, and clears the server session when starting a new chat.

## Run

From this directory, install Flutter dependencies and run the app with the API address reachable from your device:

```sh
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:8000
```

For an Android emulator use `http://10.0.2.2:8000`; for a physical device use the development machine's LAN IP. Run the backend separately from `Track2Cllg` with its configured `.env`:

```sh
uvicorn api:app --host 0.0.0.0 --port 8000
```

The API currently allows CORS from the local web preview on port 5500. Add the Flutter web app's deployed origin to `allow_origins` in `Track2Cllg/api.py` before hosting the web build from another origin. Android and iOS connect over HTTP to the configured backend URL; use HTTPS for a production deployment.
