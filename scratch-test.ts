import { db } from "./src/db/client.js";

// Let's print the session object keys and the transaction method of session
console.log("session keys:", Object.keys(db.session));
console.log("session.transaction:", db.session.transaction.toString());
