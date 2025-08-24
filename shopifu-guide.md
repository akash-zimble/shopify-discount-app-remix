# Shopify App Creation Guide

Follow these steps to create shopify app using remix

## 1. App Creation
Create App using any one of both commands
``npm create @shopify/app@latest`` ``shopify app init``

I suggest installing Shopify CLI for better features

While you creating it asks you somethings
1. App type (select Remix)
2. Language JavaScript or TypeScript(Select Type Script)
3. New / Existing App (select new app)
4. give name for new App

After creating app then run ``npm run dev``, then it will ask you select store on which you want test/build.

Then it will give your shopify store link open it and install app

## 2. App Scope Changes
In this step you will be changing the scopes of your app. You will be giving the store scopes which are needed for app.

Change shopify.app.toml ``[access_scopes]``
After changing these scopes it wont reflect, unless you rel