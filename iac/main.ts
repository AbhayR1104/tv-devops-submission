import { App, TerraformOutput, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { EcrRepository } from "@cdktf/provider-aws/lib/ecr-repository";

import { Vpc } from "@cdktf/provider-aws/lib/vpc";
import { Subnet } from "@cdktf/provider-aws/lib/subnet";
import { InternetGateway } from "@cdktf/provider-aws/lib/internet-gateway";
import { RouteTable } from "@cdktf/provider-aws/lib/route-table";
import { RouteTableAssociation } from "@cdktf/provider-aws/lib/route-table-association";
import { Route } from "@cdktf/provider-aws/lib/route";

import { SecurityGroup } from "@cdktf/provider-aws/lib/security-group";
import { Lb } from "@cdktf/provider-aws/lib/lb";
import { LbTargetGroup } from "@cdktf/provider-aws/lib/lb-target-group";
import { LbListener } from "@cdktf/provider-aws/lib/lb-listener";

import { EcsCluster } from "@cdktf/provider-aws/lib/ecs-cluster";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment";
import { EcsTaskDefinition } from "@cdktf/provider-aws/lib/ecs-task-definition";
import { EcsService } from "@cdktf/provider-aws/lib/ecs-service";

class Stack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const region = process.env.AWS_REGION || "us-west-2";
    const project = process.env.PROJECT_NAME || "tv-devops";
    const env = process.env.ENVIRONMENT || "dev";

    // IMPORTANT: set this to the exact image you pushed
    const imageUri =
      process.env.IMAGE_URI ||
      `${process.env.AWS_ACCOUNT_ID || "342573630114"}.dkr.ecr.${region}.amazonaws.com/${project}-${env}:latest`;

    const containerPort = Number(process.env.CONTAINER_PORT || "3000");

    new AwsProvider(this, "aws", { region });

    // ---------- ECR (already created, but safe to keep in stack) ----------
    const repoName = `${project}-${env}`;
    const ecr = new EcrRepository(this, "ecr", {
      name: repoName,
      imageTagMutability: "MUTABLE",
      forceDelete: true,
    });

    // ---------- Networking: VPC + 2 public subnets ----------
    const vpc = new Vpc(this, "vpc", {
      cidrBlock: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: { Name: `${project}-${env}-vpc` },
    });

    const subnetA = new Subnet(this, "subnetA", {
      vpcId: vpc.id,
      cidrBlock: "10.0.1.0/24",
      availabilityZone: `${region}a`,
      mapPublicIpOnLaunch: true,
      tags: { Name: `${project}-${env}-public-a` },
    });

    const subnetB = new Subnet(this, "subnetB", {
      vpcId: vpc.id,
      cidrBlock: "10.0.2.0/24",
      availabilityZone: `${region}b`,
      mapPublicIpOnLaunch: true,
      tags: { Name: `${project}-${env}-public-b` },
    });

    const igw = new InternetGateway(this, "igw", {
      vpcId: vpc.id,
      tags: { Name: `${project}-${env}-igw` },
    });

    const rt = new RouteTable(this, "publicRt", {
      vpcId: vpc.id,
      tags: { Name: `${project}-${env}-public-rt` },
    });

    new Route(this, "defaultRoute", {
      routeTableId: rt.id,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    });

    new RouteTableAssociation(this, "rtaA", {
      routeTableId: rt.id,
      subnetId: subnetA.id,
    });

    new RouteTableAssociation(this, "rtaB", {
      routeTableId: rt.id,
      subnetId: subnetB.id,
    });

    // ---------- Security Groups ----------
    const albSg = new SecurityGroup(this, "albSg", {
      vpcId: vpc.id,
      name: `${project}-${env}-alb-sg`,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    });

    const taskSg = new SecurityGroup(this, "taskSg", {
      vpcId: vpc.id,
      name: `${project}-${env}-task-sg`,
      ingress: [
        {
          protocol: "tcp",
          fromPort: containerPort,
          toPort: containerPort,
          securityGroups: [albSg.id], // only ALB can reach tasks
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
    });

    // ---------- ALB ----------
    const alb = new Lb(this, "alb", {
      name: `${project}-${env}-alb`,
      loadBalancerType: "application",
      internal: false,
      securityGroups: [albSg.id],
      subnets: [subnetA.id, subnetB.id],
    });

    const tg = new LbTargetGroup(this, "tg", {
      name: `${project}-${env}-tg`,
      port: containerPort,
      protocol: "HTTP",
      vpcId: vpc.id,
      targetType: "ip",
      healthCheck: {
        path: "/health",
        protocol: "HTTP",
        matcher: "200",
      },
    });

    new LbListener(this, "listener", {
      loadBalancerArn: alb.arn,
      port: 80,
      protocol: "HTTP",
      defaultAction: [
        {
          type: "forward",
          targetGroupArn: tg.arn,
        },
      ],
    });

    // ---------- ECS ----------
    const cluster = new EcsCluster(this, "cluster", {
      name: `${project}-${env}-cluster`,
    });

    const logGroup = new CloudwatchLogGroup(this, "logGroup", {
      name: `/ecs/${project}-${env}`,
      retentionInDays: 7,
    });

    // IAM execution role for ECS tasks (pull from ECR + write logs)
    const execRole = new IamRole(this, "execRole", {
      name: `${project}-${env}-ecs-exec-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });

    new IamRolePolicyAttachment(this, "execRoleAttach", {
      role: execRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    const taskDef = new EcsTaskDefinition(this, "taskDef", {
      family: `${project}-${env}`,
      cpu: "256",
      memory: "512",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      executionRoleArn: execRole.arn,
      containerDefinitions: JSON.stringify([
        {
          name: "app",
          image: imageUri,
          essential: true,
          portMappings: [{ containerPort, protocol: "tcp" }],
          environment: [{ name: "PORT", value: String(containerPort) }],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup.name,
              "awslogs-region": region,
              "awslogs-stream-prefix": "ecs",
            },
          },
        },
      ]),
    });

    const service = new EcsService(this, "service", {
      name: `${project}-${env}-service`,
      cluster: cluster.arn,
      taskDefinition: taskDef.arn,
      desiredCount: 1,
      launchType: "FARGATE",
      networkConfiguration: {
        subnets: [subnetA.id, subnetB.id],
        securityGroups: [taskSg.id],
        assignPublicIp: true,
      },
      loadBalancer: [
        {
          targetGroupArn: tg.arn,
          containerName: "app",
          containerPort: containerPort,
        },
      ],
      dependsOn: [tg],
    });

    // ---------- Outputs ----------
    new TerraformOutput(this, "alb_dns_name", {
      value: alb.dnsName,
    });

    new TerraformOutput(this, "health_url", {
      value: `http://${alb.dnsName}/health`,
    });

    new TerraformOutput(this, "ecr_repository_url", {
      value: ecr.repositoryUrl,
    });

    new TerraformOutput(this, "ecs_service_name", {
      value: service.name,
    });
  }
}

const app = new App();
new Stack(app, "tv-devops");
app.synth();
