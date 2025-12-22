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
    const paymentCollection = db.collection("payments");
    const taskCollection = db.collection("tasks");

    const syncPaymentCountToContests = async () => {
      const paymentStats = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: "$contestId",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      if (!paymentStats.length) return;

      const bulkOps = paymentStats.map((stat) => ({
        updateOne: {
          filter: { _id: new ObjectId(stat._id) },
          update: { $set: { paymentCount: stat.count } },
        },
      }));

      await contestsCollection.bulkWrite(bulkOps);

      await contestsCollection.updateMany(
        { paymentCount: { $exists: false } },
        { $set: { paymentCount: 0 } }
      );
    };

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

    app.get("/popular-contest", async (req, res) => {
      const cursor = contestsCollection.find();
      const result = await cursor.sort({ paymentCount: -1 }).limit(5).toArray();
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

    app.patch("/users/profile/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const updateProfile = req.body;
      const query = { email };
      const updatedDoc = {
        $set: {
          displayName: updateProfile.displayName,
          photoURL: updateProfile.photoURL,
          address: updateProfile.address,
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
        customer_email: paymentInfo.customer_email,
        mode: "payment",
        metadata: {
          contestId: paymentInfo.contestId,
          contestName: paymentInfo.contestName,
          contestDeadline: paymentInfo.contestDeadline,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
      });
      // console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-seccess", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log("session retrieved", session);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({ message: "payment already exists" });
      }
      if (session.payment_status === "paid") {
        const id = session.metadata.contestId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
          },
        };
        const result = await contestsCollection.updateOne(query, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          contestId: session.metadata.contestId,
          contestName: session.metadata.contestName,
          contestDeadline: session.metadata.contestDeadline,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          await syncPaymentCountToContests();
          return res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
          });
        }
      }

      res.send({ success: false });
    });

    app.get("/my-participated-contests/payment", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        // if (email !== req.decoded_email) {
        //   return res.status(403).send({ message: "Forbidden Access" });
        // }
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/payment/:id", async (req, res) => {
      const id = req.params.id;
      // console.log(contestId);
      const query = { contestId: id };
      const result = await paymentCollection.findOne(query);
      // console.log(result);
      res.send(result);
    });

    // task related apis
    app.post("/task-submission", verifyFBToken, async (req, res) => {
      const taskInfo = req.body;
      const result = await taskCollection.insertOne(taskInfo);
      res.send(result);
    });

    app.get("/tasks", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.creatorMail = email;
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
      }
      const cursor = taskCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/tasks/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const taskInfo = req.body;
      const query = { contestId: id };
      const updatedDoc = {
        $set: {
          winnerStatus: taskInfo.winnerStatus,
        },
      };
      const result = await taskCollection.updateMany(query, updatedDoc);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
