import { db } from "./src/db/client.js";

const result = db.transaction((tx) => {
  return "test";
}, { behavior: "exclusive" });
console.log("Result:", result);
