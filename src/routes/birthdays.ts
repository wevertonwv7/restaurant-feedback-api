import { Hono } from "hono";

const birthdays = new Hono();

birthdays.get("/", (c) => {
  return c.json({
    birthdays: []
  });
});

export default birthdays;