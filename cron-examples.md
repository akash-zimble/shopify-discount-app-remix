# Discount Cleanup Cron Job Examples

## 🕐 Cron Schedule Options

### Every 5 minutes (Recommended)
```bash
*/5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup"
```

### Every 10 minutes
```bash
*/10 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup"
```

### Every hour
```bash
0 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup"
```

### Every day at 2 AM
```bash
0 2 * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup"
```

## 🔧 Setup Instructions

### 1. Environment Variables
Add to your `.env` file:
```bash
CRON_SECRET_TOKEN=your-secure-token-here
```

Generate a secure token:
```bash
openssl rand -hex 32
```

### 2. Manual Crontab Setup
```bash
# Edit crontab
crontab -e

# Add the cron job line
*/5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup"
```

### 3. Using the Setup Script
```bash
# Make sure CRON_SECRET_TOKEN is set in your environment
export CRON_SECRET_TOKEN=your-token-here
export APP_URL=https://your-app-url.com

# Run the setup script
./cron-setup.sh
```

## 🧪 Testing

### Test the endpoint manually:
```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET_TOKEN" \
  -H "Content-Type: application/json" \
  "https://your-app-url.com/cron/discount-cleanup"
```

### Expected response:
```json
{
  "success": true,
  "message": "Processed 5 discounts",
  "expired": [
    {
      "id": "gid://shopify/DiscountAutomaticNode/123",
      "title": "Summer Sale",
      "endDate": "2024-01-15T23:59:59.000Z"
    }
  ],
  "deactivatedCount": 1
}
```

## 📊 Monitoring

### Check cron job logs:
```bash
# View cron logs
tail -f /var/log/cron

# Check if cron is running
systemctl status cron
```

### Monitor your app logs for cron job execution:
```bash
# If using PM2
pm2 logs your-app-name

# If using Docker
docker logs your-container-name
```

## 🚨 Troubleshooting

### Common Issues:

1. **401 Unauthorized**: Check CRON_SECRET_TOKEN
2. **Connection refused**: Verify APP_URL is correct
3. **Cron not running**: Check cron service status
4. **No expired discounts**: Normal if no discounts have expired

### Debug mode:
Add logging to see what's happening:
```bash
*/5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET_TOKEN" "https://your-app-url.com/cron/discount-cleanup" >> /var/log/discount-cleanup.log 2>&1
```

## 🔒 Security Notes

- Keep CRON_SECRET_TOKEN secure and don't commit it to version control
- Use HTTPS for your app URL
- Consider IP whitelisting if possible
- Monitor for unusual cron job activity
