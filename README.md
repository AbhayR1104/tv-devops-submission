# TV DevOps Submission (ECS Fargate + CDKTF + GitHub Actions)

This repo deploys a containerized Node/Express app to **AWS ECS Fargate** behind an **Application Load Balancer (ALB)** using **CDK for Terraform (CDKTF)**.CI/CD is handled by **GitHub Actions**, which builds a **linux/amd64** Docker image, pushes it to **Amazon ECR**, and updates the ECS service.

---

## What’s inside

- `app/` — Node/Express app (includes `/health` endpoint)
- `iac/` — CDKTF (TypeScript) that provisions:
  - VPC + 2 public subnets + IGW + routes
  - Security groups
  - ALB + Target Group + Listener
  - ECS Cluster + Task Definition + Service (Fargate)
  - CloudWatch Log Group for ECS logs
  - Remote Terraform backend (S3 + DynamoDB)
  - CloudWatch alarm + SNS notifications

---

## Live endpoints 

After deploy, CDKTF prints outputs like:

- `alb_dns_name`: `tv-devops-dev-alb-....us-west-2.elb.amazonaws.com`
- `health_url`: `http://<alb_dns_name>/health`

Expected response:

```bash
curl -i http://<alb_dns_name>/health
# HTTP/1.1 200 OK
# ok
```

---

## Prerequisites 

- Node.js 20+
- Docker Desktop
- AWS CLI authenticated (`aws sts get-caller-identity` should work)
- Terraform CLI installed (`terraform -version`)
- CDKTF CLI (`npm i -g cdktf-cli`)

---

## Local deployment 

### 1) Install dependencies

```bash
cd iac
npm install --legacy-peer-deps
npm run get
```

### 2) Build & push image to ECR

> **Important:** ECS runs on **linux/amd64**, so build with `buildx`.

```bash
cd ../app

AWS_REGION=us-west-2
ACCOUNT_ID=<your_account_id>
ECR="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
REPO="tv-devops-dev"

aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR"

# create repo once (if needed)
aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" >/dev/null 2>&1 ||   aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION" >/dev/null

docker buildx build --platform linux/amd64   -t "${ECR}/${REPO}:latest"   --push   .
```

### 3) Deploy infrastructure

```bash
cd ../iac

export AWS_REGION=us-west-2
export PROJECT_NAME=tv-devops
export ENVIRONMENT=dev
export CONTAINER_PORT=3000
export IMAGE_URI="${ECR}/${REPO}:latest"

cdktf deploy --auto-approve
```

---

## Multi-environment support (dev / staging / prod)

Environment isolation is done via:

- `ENVIRONMENT` (affects naming + state)
- Stack name: `tv-devops-<env>`
- Resource names include `<project>-<env>` (e.g., `tv-devops-staging-alb`)

Example synth checks:

```bash
cd iac
ENVIRONMENT=dev cdktf synth
ENVIRONMENT=staging cdktf synth
ENVIRONMENT=prod cdktf synth
```

---

## Remote Terraform backend (S3 + DynamoDB)

Remote state is **recommended for production-grade** usage so CI + local runs share the same Terraform state.

### 1) Create backend resources 
```bash
AWS_REGION=us-west-2

aws s3 mb s3://tv-devops-tf-state --region "$AWS_REGION"

aws dynamodb create-table   --table-name tv-devops-tf-lock   --attribute-definitions AttributeName=LockID,AttributeType=S   --key-schema AttributeName=LockID,KeyType=HASH   --billing-mode PAY_PER_REQUEST   --region "$AWS_REGION"
```

### 2) Deploy with remote backend

```bash
cd iac

export TF_BACKEND=remote
export TF_STATE_BUCKET=tv-devops-tf-state
export TF_LOCK_TABLE=tv-devops-tf-lock

cdktf deploy --auto-approve
```

State key pattern: `tv-devops/<env>/terraform.tfstate`

> **Note on cost:** S3 + DynamoDB are low-cost but not strictly free.

---

## CloudWatch logs + alerts (bonus)

- ECS tasks send logs to CloudWatch Logs (log group `/ecs/<project>-<env>`)
- Optional alarm watches ALB target group health and publishes to SNS

Enable:

```bash
export ENABLE_ALERTS=true
export ALERT_EMAIL="you@example.com"
cdktf deploy --auto-approve
```

---

## CI/CD (GitHub Actions)

Workflow file: `.github/workflows/deploy.yml`

### Required GitHub secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- *(optional for alerts)* `ALERT_EMAIL`

> Production recommendation: use **GitHub OIDC + role assumption** instead of static keys.

### Notes

- The workflow builds with `--platform linux/amd64`
- It uses `-f ./app/Dockerfile` and build context `./app`
- Terraform must be installed in the runner (CDKTF shells out to `terraform`)

---

## Cleanup (to avoid charges of aws)

```bash
cd iac
cdktf destroy --auto-approve
```

Also delete/stop any remaining AWS resources (ALB, ECS, ECR images, etc.) if you created them manually.

