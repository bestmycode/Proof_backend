import { initializeApp } from "firebase/app";
import authenticate from "../middleware/authenticate.js";
import firebaseAdmin from "../services/firebase.js";
import {
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup
} from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  query,
  where
} from "firebase/firestore";
import { firebaseConfig } from "../services/firebaseConfig.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

const getMe = async (req, res) => {
  const _id = req.params.id;
  const { authorization } = req.headers;
  const token = authorization
    ? authorization.split("Bearer ").length
      ? authorization.split("Bearer ")[1]
      : null
    : null;
  console.log(token);

  if (token) {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    if (_id === user.id.id) {
      return res.status(200).json({ user: user.id });
    } else {
      return res.status(400).json("User not found");
    }
  } else {
    return res.status(500).json({ error: "Token not found" });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const _id = req.params.id;
    const { authorization } = req.headers;
    const token = authorization
      ? authorization.split("Bearer ").length
        ? authorization.split("Bearer ")[1]
        : null
      : null;
    console.log(token);
    if (token) {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      if (_id === user.id.id) {
        const db = req.app.locals.db;
        const users = await db.collection("user").find({}).toArray();
        if (users) {
          return res.status(200).json(users);
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
};

const registerUser = async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({
      error: "Please provide email, password and name for user"
    });
  }

  try {
    const newFirebaseUser = await firebaseAdmin.auth.createUser({
      email,
      password
    });

    if (newFirebaseUser) {
      //   const token = await firebaseAdmin.auth.createCustomToken(
      //     newFirebaseUser.uid
      //   );
      const userCollection = req.app.locals.db.collection("user");
      const user = await userCollection.insertOne({
        email,
        name,
        firebaseId: newFirebaseUser.uid,
        surfingBalance: 0,
        advertisingBalance: 0
      });

      const newUser = await userCollection.findOne(user._id);
      const payload = {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        surfingBalance: newUser.surfingBalance,
        advertisingBalance: newUser.advertisingBalance
      };
      const token = await generateToken(payload);
      if (token) {
        return res.status(201).json({ token: token });
      } else {
        return res.status(400).json("Unable to generate token");
      }
      // return res.status(201).json({
      //   id: newUser._id,
      //   name: newUser.name,
      //   email: newUser.email,
      //   surfingBalance: newUser.surfingBalance,
      //   advertisingBalance: newUser.advertisingBalance,
      //   token: generateToken(newUser._id)
      // });
    }
  } catch (error) {
    const message =
      error.code && error.code === "auth/email-already-exists"
        ? `User with email: ${email} already exists`
        : error.toString();
    return res.status(400).json({ error: message });
  }
};

const registerWithGoogle = async (req, res) => {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    const user = res.user;
    const q = query(collection(db, "users"), where("uid", "==", user.uid));
    const docs = await getDocs(q);
    if (docs.docs.length === 0) {
      await addDoc(collection(db, "users"), {
        uid: user.uid,
        name: user.displayName,
        authProvider: "google",
        email: user.email
      });
    }
    const userCollection = req.app.locals.db.collection("user");
    const data = await userCollection.insertOne({
      email: user.email,
      name: user.displayName,
      firebaseId: user.uid,
      surfingBalance: 0,
      advertisingBalance: 0
    });

    const newUser = await userCollection.findOne(data._id);
    const payload = {
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      surfingBalance: newUser.surfingBalance,
      advertisingBalance: newUser.advertisingBalance
    };
    const token = await generateToken(payload);
    if (token) {
      return res.status(201).json({ token: token });
    } else {
      return res.status(400).json("Unable to generate token");
    }
    // return res.status(201).json({
    //   id: newUser._id,
    //   name: newUser.name,
    //   email: newUser.email,
    //   surfingBalance: newUser.surfingBalance,
    //   advertisingBalance: newUser.advertisingBalance,
    //   token: generateToken(newUser._id)
    // });
  } catch (error) {
    console.error(error);
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Please provide email, password for user"
    });
  }
  try {
    const email_exists = await firebaseAdmin.auth.getUserByEmail(email);
    if (email_exists) {
      //   const token = await firebaseAdmin.auth.createCustomToken(
      //     email_exists.uid
      //   );
      await signInWithEmailAndPassword(auth, email, password);
      const userData = await req.app.locals.db
        .collection("user")
        .findOne({ email });
      const payload = {
        id: userData._id,
        name: userData.name,
        email: userData.email,
        surfingBalance: userData.surfingBalance,
        advertisingBalance: userData.advertisingBalance
      };
      const token = await generateToken(payload);
      if (token) {
        return res.status(201).json({ token: token });
      } else {
        return res.status(400).json("Unable to generate token");
      }
    }
  } catch (error) {
    const message =
      error.code && error.code === "auth/user-not-found"
        ? `User with the email ${email} is not found`
        : error.code === "auth/wrong-password"
          ? "Invalid email or password"
          : error.toString();
    return res.status(400).json({ error: message });
  }
};

const resetPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({
      error: "Please provide your email"
    });
  }
  try {
    await sendPasswordResetEmail(auth, email);
    return res.status(200).json({
      message: `Password reset sent to the ${email}, check your inbox or spam message`
    });
  } catch (error) {
    console.log(error);
  }
};

//Generate JWT
const generateToken = id => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d"
  });
};

export {
  registerUser,
  registerWithGoogle,
  loginUser,
  resetPassword,
  getMe,
  getAllUsers
};
