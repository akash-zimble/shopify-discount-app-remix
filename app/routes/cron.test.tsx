import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Simple test endpoint to verify cron setup
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET_TOKEN;
  
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return json({ 
      error: "Unauthorized",
      message: "Please provide correct CRON_SECRET_TOKEN in Authorization header"
    }, { status: 401 });
  }

  const currentTime = new Date();
  
  return json({
    success: true,
    message: "Cron test endpoint is working!",
    timestamp: currentTime.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    environment: process.env.NODE_ENV || "development"
  });
};

export const loader = async () => {
  return json({
    message: "This is a test endpoint for cron jobs",
    usage: "Send POST request with Authorization: Bearer <CRON_SECRET_TOKEN>",
    example: "curl -X POST -H 'Authorization: Bearer your-token' https://your-app.com/cron/test"
  });
};
