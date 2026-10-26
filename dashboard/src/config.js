// -----------------------------------------------------------------------
// HighLo endpoint configuration
// -----------------------------------------------------------------------
// Where the camera and detections come from. Every value is optional: when
// nothing is set, HighLo shows its built-in mock table so every screen still
// looks alive.
//
// The normal way to connect a phone camera is the "Camera" button in the top
// bar (it asks for the camera server's address and access token and remembers
// them in this browser). The two VITE_ values below are only a shortcut for
// local development - anything starting with VITE_ is copied into the public
// website files, so don't put a real token there for a deployed site.

const config = {
  // Address printed by the camera server, e.g. "https://192.168.1.20:8443".
  // Set in a .env file as VITE_CAMERA_SERVER_URL.
  CAMERA_SERVER_URL: import.meta.env.VITE_CAMERA_SERVER_URL || null,

  // The server's viewer access token. Set as VITE_CAMERA_SERVER_TOKEN.
  CAMERA_SERVER_TOKEN: import.meta.env.VITE_CAMERA_SERVER_TOKEN || null,

  // Optional: a plain MJPEG/HLS stream from some other camera. The feed panel
  // shows it instead of the grey placeholder. (The camera server's own stream
  // is picked up automatically and takes priority while it is live.)
  CAMERA_STREAM_URL: null,

  // REST base for auth / gameplay history / analysis reports. When null,
  // auth + history calls are simulated in-memory (see state/AppStateContext).
  API_BASE_URL: null,
};

export default config;
