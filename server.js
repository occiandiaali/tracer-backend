require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const port = process.env.PORT || 3000;
const jwtSecretKey = process.env.JWT_SECRET_KEY;
const mongoAtlasUri = process.env.MONGODB_ATLAS_URI;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tracer.puter.site"],
    credentials: true,
  }),
);

// MongoDB Atlas connection
mongoose
  .connect(mongoAtlasUri)
  .then(() => console.log("Database connected!"))
  .catch((err) => console.error("Database connection error:", err));

// Schemas
const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
});
const TraceSchema = new mongoose.Schema({
  userId: String,
  points: [{ lat: Number, lng: Number, timestamp: Number }],
});

const User = mongoose.model("User", UserSchema);
const Trace = mongoose.model("Trace", TraceSchema);

// Helpers
const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.sendStatus(401);
  try {
    req.user = jwt.verify(token, jwtSecretKey);
    next();
  } catch {
    res.sendStatus(403);
  }
};

// Routes
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await User.create({ email, password: hash });
  res.sendStatus(201);
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !bcrypt.compare(password, user.password))
    return res.sendStatus(401);
  const token = jwt.sign({ id: user._id }, jwtSecretKey);
  res.cookie("token", token, { httpOnly: true }).sendStatus(200);
});

app.post("/trace", authMiddleware, async (req, res) => {
  const { points } = req.body;
  await Trace.create({ userId: req.user.id, points });
  res.sendStatus(201);
});

app.get("/traces", authMiddleware, async (req, res) => {
  const traces = await Trace.find({ userId: req.user.id });
  res.json(traces);
});

// Export traces as GeoJSON
app.get("/export/geojson", authMiddleware, async (req, res) => {
  const traces = await Trace.find({ userId: req.user.id });
  const geojson = {
    type: "FeatureCollection",
    features: traces.map((trace) => ({
      type: "Feature",
      properties: { traceId: trace._id },
      geometry: {
        type: "LineString",
        coordinates: trace.points.map((p) => [p.lng, p.lat]),
      },
    })),
  };
  res.json(geojson);
});

// Export traces as GPX
app.get("/export/gpx", authMiddleware, async (req, res) => {
  const traces = await Trace.find({ userId: req.user.id });
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GeoTracker">
`;
  traces.forEach((trace) => {
    gpx += `<trk><name>${trace._id}</name><trkseg>`;
    trace.points.forEach((p) => {
      gpx += `<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.timestamp).toISOString()}</time></trkpt>`;
    });
    gpx += `</trkseg></trk>`;
  });
  gpx += `</gpx>`;
  res.header("Content-Type", "application/gpx+xml");
  res.send(gpx);
});

app.listen(port, () =>
  console.log("Server running on http://localhost:" + port),
);
