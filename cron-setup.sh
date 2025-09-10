#!/bin/bash

# Discount Cleanup Cron Job Setup
# This script helps you set up a cron job to run every 5 minutes

echo "Setting up discount cleanup cron job..."

# Check if CRON_SECRET_TOKEN is set
if [ -z "$CRON_SECRET_TOKEN" ]; then
    echo "⚠️  CRON_SECRET_TOKEN environment variable is not set!"
    echo "Please set it in your .env file:"
    echo "CRON_SECRET_TOKEN=your-secret-token-here"
    echo ""
    echo "Generate a secure token with:"
    echo "openssl rand -hex 32"
    exit 1
fi

# Get your app URL (you'll need to replace this with your actual URL)
APP_URL=${APP_URL:-"https://your-app-url.com"}

echo "App URL: $APP_URL"
echo "Cron endpoint: $APP_URL/cron/discount-cleanup"

# Create the cron job entry
CRON_ENTRY="*/5 * * * * curl -X POST -H \"Authorization: Bearer $CRON_SECRET_TOKEN\" -H \"Content-Type: application/json\" \"$APP_URL/cron/discount-cleanup\""

echo ""
echo "Add this line to your crontab:"
echo "$CRON_ENTRY"
echo ""

# Option to add to crontab automatically
read -p "Do you want to add this to your crontab automatically? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Add to crontab
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "✅ Cron job added successfully!"
    echo "Run 'crontab -l' to verify it was added."
else
    echo "To add manually, run:"
    echo "crontab -e"
    echo "Then add the line above."
fi

echo ""
echo "📋 Manual setup instructions:"
echo "1. Set CRON_SECRET_TOKEN in your .env file"
echo "2. Replace APP_URL with your actual app URL"
echo "3. Add the cron entry to your crontab"
echo "4. Test the endpoint manually first:"
echo "   curl -X POST -H \"Authorization: Bearer \$CRON_SECRET_TOKEN\" \"$APP_URL/cron/discount-cleanup\""
