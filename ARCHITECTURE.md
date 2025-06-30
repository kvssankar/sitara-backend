
# Architecture Overview

![alt text](docs/architecture.png)

## Heart of Sitaara: Serverless Lambda Functions
Lambda functions serve as the core orchestration layer that handles all business logic, from crud operations to intent recognition, AI processing and tool execution, making the entire system event-driven and serverless.

### Lambda Functions Breakdown
1. **User CRUD (Support cases) Lambda:** Handles CRUD operations for support cases and customer data stored in DynamoDB
2. **Admin CRUD (Intents and tool creation) Lambda:** Manages creation, updates, and deletion of intents and tools stored in MongoDB
3. **Intents RAG Lambda:** Performs vector search in OpenSearch Serverless to identify customer intent using semantic similarity matching
4. **Process Messages Lambda:** Main orchestrator that processes incoming support messages from SQS and coordinates the entire conversation flow
5. **Tool Executor Lambda:** Executes custom Python scripts/tools dynamically when the AI agent needs to perform specific automated actions

### Frontend Layer
- **Web Application**: React-based frontend with pre-signed URL upload capability for file handling
- **Amazon API Gateway**: Serves as the entry point for all client requests with proper CORS configuration

# Core Processing Flow


### **Phase 1: Admin Configuration**

**Admin creates intents (topics) and custom tools through the Admin CRUD Lambda, storing standardized SOPs with step-by-step workflows in MongoDB.** 

These intents define how specific customer issues should be handled, including which tools to execute and what questions to ask, creating a comprehensive knowledge base for automated resolution.

### **Phase 2: Customer Interaction & Intent Recognition**

**Customer sends a support message which creates a case in DynamoDB and triggers the Process Messages Lambda via SQS.** 

The Intents RAG Lambda performs vector search in OpenSearch to identify the customer's intent with confidence scoring - if >90% confident, it proceeds automatically; if <50%, it presents multiple intent options to human agents for verification and selection.

### **Phase 3: Automated Resolution & Case Completion**

**Once intent is confirmed, the AI agent follows the predefined SOP steps, executes necessary tools via Tool Executor Lambda, and maintains conversation with the customer until resolution.** 

Throughout the process, all interactions are stored in DynamoDB, and upon completion, a comprehensive case summary is generated analyzing the customer issue, AI performance, resolution effectiveness, and customer satisfaction for continuous improvement.

# **Key Architectural Patterns**

**Serverless-First Design**: All compute is handled by AWS Lambda functions, ensuring automatic scaling and cost optimization.

**Event-Driven Architecture**: Uses SQS for decoupling message processing, allowing for better resilience and scalability.

**Microservices Pattern**: Each Lambda function has a specific responsibility (CRUD operations, message processing, tool execution).

**Shared Layer**: Common utilities and business logic are shared across Lambda functions through a core layer, promoting code reuse and consistency.

## **Data Flow Process**

1. **User Request** → API Gateway → Appropriate Lambda function
2. **Message Processing** → SQS → Process Messages Lambda
3. **Intent Recognition** → Intents RAG Lambda → OpenSearch Vector DB
4. **AI Processing** → Anthropic LLM via Bedrock
5. **Tool Execution** → Tool Executor Lambda (when needed)
6. **Data Persistence** → DynamoDB (cases/messages) + MongoDB (intents/tools)

## **Integration Points**

**Vector Search**: OpenSearch Serverless provides semantic similarity search for intent matching

**AI Integration**: Bedrock serves as the managed AI service layer

**File Handling**: S3 integration with pre-signed URLs for secure file uploads

**Message Queuing**: SQS ensures reliable message processing and system resilience


## **Serverless Best Practices Implemented in Sitaara**



### **1. Single Responsibility Principle**

-   **5 specialized Lambda functions** each handling one specific domain (Admin CRUD, Intents RAG, Support CRUD, Process Messages, Tool Executor)
-   **Microservices approach** with clear separation of concerns
-   **Domain-driven design** where each Lambda owns its specific business logic

### **2. Event-Driven Architecture**

-   **Amazon SQS integration** for asynchronous message processing
-   **Decoupled components** that communicate through events rather than direct calls
-   **Fault-tolerant design** where failures in one component don't cascade

### **3. Shared Layer Pattern**

-   **Reusable shared layer** (`shared-layer/nodejs/sitara/`) containing common utilities
-   **DRY principle** implementation across all Lambda functions
-   **Centralized business logic** for database operations, API helpers, and utilities

## **🔧 Code Organization & Structure**

### **4. Environment Configuration**

-   **Environment variables** for all configuration (API keys, database connections, regions)
-   **Secure secrets management** using AWS environment variables
-   **Region-specific configuration** with fallback defaults

### **5. Error Handling & Resilience**

```javascript
// Comprehensive error handling pattern
export const handleError = (error, context) => {
  console.error(`Error ${context}:`, error);
  return createResponse(500, { error: error.message });
};

```

### **6. Connection Reuse & Optimization**

-   **Client initialization outside handlers** for connection reuse
-   **Cached database connections** in MongoDB client
-   **Singleton pattern** for expensive client instantiations

## **⚡ Performance & Scalability**

### **7. Asynchronous Processing**

-   **SQS queues** for handling message processing at scale
-   **Batch processing** capabilities for multiple messages
-   **Non-blocking operations** throughout the codebase

### **8. Efficient Data Access Patterns**

-   **DynamoDB with GSI** for optimized query patterns
-   **Vector search with OpenSearch** for semantic similarity
-   **Proper indexing strategy** for different access patterns

### **9. Lambda Cold Start Optimization**

-   **Minimal dependencies** in each function
-   **Shared layers** to reduce deployment package size
-   **Connection pooling** and client reuse

## **🛡️ Security & Compliance**

### **10. API Security**

-   **CORS configuration** properly implemented
-   **Request validation** and input sanitization
-   **Authorization headers** for user authentication

### **11. Secure Inter-Service Communication**

-   **AWS IAM roles** for Lambda-to-Lambda communication
-   **Encrypted payloads** for sensitive data transmission
-   **Secure environment variable usage**

## **📊 Monitoring & Observability**

### **12. Comprehensive Logging**

```javascript
console.log(`[processNewTicket] Finding intents for text: "${text}"`);
console.log(`[handler] Received batch with ${event.Records.length} messages`);

```

-   **Structured logging** with context information
-   **Request tracing** throughout the application flow
-   **Error logging** with detailed stack traces

### **13. Operational Excellence**

-   **Graceful degradation** when external services fail
-   **Retry mechanisms** for transient failures
-   **Circuit breaker patterns** for external API calls

## **💰 Cost Optimization**

### **14. Pay-per-Use Model**

-   **Pure serverless architecture** with no always-on resources
-   **Auto-scaling** based on actual demand
-   **Resource right-sizing** for each Lambda function's needs

### **15. Efficient Resource Utilization**

-   **Shared layers** to reduce code duplication and deployment size
-   **Optimized memory allocation** based on function requirements
-   **Connection pooling** to minimize initialization overhead

## **🔄 DevOps & Deployment**

### **16. Infrastructure as Code Ready**

-   **Environment-driven configuration** making IaC deployment straightforward
-   **Stateless functions** that can be deployed anywhere
-   **Version control friendly** structure

### **17. API Design Best Practices**

-   **RESTful API patterns** with proper HTTP methods
-   **Consistent response formats** across all endpoints
-   **Proper status codes** and error responses

## **🎯 Business Logic Patterns**

### **18. Domain-Specific Optimization**

-   **Intent recognition pipeline** optimized for AI workloads
-   **Tool execution sandbox** for secure code execution
-   **Case management workflow** designed for support processes

### **19. Data Consistency**

-   **Eventually consistent** design appropriate for support workflows
-   **Proper data modeling** for NoSQL databases
-   **Transactional operations** where needed

## **🚀 Scalability Patterns**

### **20. Horizontal Scaling**

-   **Stateless design** enabling unlimited horizontal scaling
-   **Queue-based processing** that handles traffic spikes
-   **Database scaling** through proper partitioning strategies


## Infrastructure as Code

The project includes comprehensive AWS SAM templates (`template.yaml`, `infrastructure.yaml`, `lambda-functions.yaml`, etc.) that define the complete serverless architecture with proper environment separation and modular design. Please note that these templates serve as infrastructure blueprints and require configuration of environment-specific values (MongoDB connections, OpenSearch endpoints, API keys) before deployment. The SAM files provide a solid foundation for Infrastructure as Code practices, though additional setup steps are needed to make them fully operational in your environment.

These best practices ensure that Sitaara can scale from handling a few support tickets to thousands per minute while maintaining high performance, security, and cost efficiency - all hallmarks of well-designed serverless architecture.
