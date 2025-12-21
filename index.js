const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./contest-hub-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    res.status(401).send({ message: "Unauthorized Access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@simple-crud-server.hfigrlp.mongodb.net/?appName=simple-crud-server`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contest_hub_db");
    const contestsCollection = db.collection("contests");
    const usersCollection = db.collection("users");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //contest apis
    app.post("/contests", async (req, res) => {
      const newContest = req.body;
      newContest.status = "pending";
      //   console.log(newContest)
      const result = await contestsCollection.insertOne(newContest);
      res.send(result);
    });

    app.get("/contests", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.creatorMail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
      }
      const cursor = contestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/allcontests", async (req, res) => {
      const query = { status: "confirmed" };
      const cursor = contestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/contests/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestsCollection.findOne(query);
      res.send(result);
    });

    app.patch("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const updatedContest = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          name: updatedContest.name,
          image: updatedContest.image,
          description: updatedContest.description,
          price: updatedContest.price,
          prizeMoney: updatedContest.prizeMoney,
          taskInstruction: updatedContest.taskInstruction,
          contestType: updatedContest.contestType,
          deadline: updatedContest.deadline,
        },
      };
      const result = await contestsCollection.updateOne(query, update);
      res.send(result);
    });

    app.patch("/contests/:id/status", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const statusInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: statusInfo.status,
        },
      };
      const result = await contestsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.delete("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contestsCollection.deleteOne(query);
      res.send(result);
    });

    // user apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.send({ message: "Existing User" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email/role", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.get("/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await usersCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.contestName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          contestId: paymentInfo.contestId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("contest hub server running!");
});

app.listen(port, () => {
  console.log(`contest hub server listening on port ${port}`);
});
