const path = require("path");
const express = require("express");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const AppError = require("./utils/AppError");

const userRouter = require("./routes/userRoutes");
const productRouter = require("./routes/productRoutes");
const orderRouter = require("./routes/orderRoutes");
const reviewRouter = require("./routes/reviewRoutes");
const customerRouter = require("./routes/customerRoutes");
const cartRouter = require("./routes/cartRoutes");
const themeRouter = require("./routes/themeRoutes");

const app = express();

app.use(express.static(path.join(__dirname, "public")));
app.use(helmet());

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:4000",
    ], // Add your frontend URLs
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

const limiter = rateLimit({
  max: 100,
  windowMS: 60 * 60 * 1000,
  message: "Too many reqauests from this IP, please try again in an hour",
});

app.use("/api", limiter);

// app.use(mongoSanitize());
// app.use((req, res, next) => {
//   // Basic sanitization without modifying read-only properties
//   const sanitizeObject = (obj) => {
//     if (obj && typeof obj === "object") {
//       Object.keys(obj).forEach((key) => {
//         if (key.includes("$") || key.includes(".")) {
//           delete obj[key];
//         } else if (typeof obj[key] === "object" && obj[key] !== null) {
//           sanitizeObject(obj[key]);
//         }
//       });
//     }
//   };

//   // Only sanitize body (not query which is read-only)
//   if (req.body) {
//     sanitizeObject(req.body);
//   }

//   next();
// });

// app.use(xss());
app.use(hpp());

// Test middleware
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  console.log(req.cookies);
  next();
});

// API routes
app.use("/api/v1/users", userRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/orders", orderRouter);
app.use("/api/v1/reviews", reviewRouter);
app.use("/api/v1/customers", customerRouter);
app.use("/api/v1/cart", cartRouter);
app.use("/api/v1/themes", themeRouter);

// 404 handler for unhandled routes
// Replace app.all("*", ...) with app.use:
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});
module.exports = app;
