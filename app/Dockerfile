# ---- install deps ----
    FROM node:20-alpine AS deps
    WORKDIR /app
    COPY package*.json ./
    RUN npm ci
    
    # ---- build ----
    FROM node:20-alpine AS build
    WORKDIR /app
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    RUN npm run build
    
    # ---- runtime ----
    FROM node:20-alpine
    WORKDIR /app
    
    ENV NODE_ENV=production
    ENV PORT=3000
    
    RUN addgroup -S app && adduser -S app -G app
    
    COPY --from=build /app/dist ./dist
    COPY --from=build /app/package*.json ./
    COPY --from=deps /app/node_modules ./node_modules
    
    USER app
    EXPOSE 3000
    
    CMD ["npm", "start"]
    