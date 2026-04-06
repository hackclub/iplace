# Hack Club's `<iplace>`
`<iplace>` is a public canvas of webpages embedded inside `<iframe>` elements, to which all teenagers can contribute! See it in action at [`iplace.hackclub.com`](https://iplace.hackclub.com)!

## Deploying
Use the `Dockerfile` to deploy `<iplace>`. You'll also need a PostgreSQL database to use with Prisma. The Dockerfile will automatically set it up.

Here's a list of all the environment variables that you might need:
```properties
ADMIN_SLACK_IDS=
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
DATABASE_URL=
HACKATIME_ADMIN_KEY=
INTERNAL_SECRET_TOKEN=
JWT_SECRET=
PUBLIC_SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
AIRTABLE_TABLE_ID=
SLACK_BOT_TOKEN=
HCA_CLIENT_ID=
HCA_CLIENT_SECRET=
```
