import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET as string;

export function generateToken(payload: any) {
  return jwt.sign(payload, secret, {
    expiresIn: "7d"
  });
}

export function verifyToken(token: string) {
  return jwt.verify(token, secret);
}