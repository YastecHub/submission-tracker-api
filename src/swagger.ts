import swaggerJsdoc from 'swagger-jsdoc';

const servers = [
  ...(process.env.RENDER_EXTERNAL_URL
    ? [{ url: process.env.RENDER_EXTERNAL_URL, description: 'Production (Render)' }]
    : []),
  {
    url: `http://localhost:${process.env.PORT ?? 3001}`,
    description: 'Local development server',
  },
];

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'NEXIUM API',
      version: '1.0.0',
      description:
        'NEXIUM — class submissions, payments and account transparency. ' +
        'CRs create events and confirm submissions; students submit without an account.',
    },
    servers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from POST /api/auth/login',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SubmissionEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string', example: 'aB3dE7f' },
            title: { type: 'string', example: 'Assignment 1' },
            courseCode: { type: 'string', example: 'CSC401' },
            type: { type: 'string', enum: ['assignment', 'attendance', 'lab', 'other'] },
            description: { type: 'string', nullable: true },
            deadline: { type: 'string', format: 'date-time' },
            isClosed: { type: 'boolean' },
            isDeleted: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            totalSubmissions: { type: 'integer' },
            confirmedCount: { type: 'integer' },
            pendingCount: { type: 'integer' },
          },
        },
        Submission: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
            fullName: { type: 'string', example: 'Amina Bello' },
            matricNumber: { type: 'string', example: '2021/12345' },
            level: {
              type: 'string',
              nullable: true,
              enum: ['100L', '200L', '300L', '400L', '500L', 'Postgrad', null],
            },
            qrCode: { type: 'string', description: 'Base64 PNG data URL' },
            submittedAt: { type: 'string', format: 'date-time' },
            isConfirmed: { type: 'boolean' },
            confirmedAt: { type: 'string', format: 'date-time', nullable: true },
            confirmedBy: { type: 'string', nullable: true },
          },
        },
        PaymentEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            amount: { type: 'string', example: '5000.00' },
            accountNumber: { type: 'string' },
            accountName: { type: 'string' },
            bankName: { type: 'string' },
            deadline: { type: 'string', format: 'date-time' },
            hasTickets: { type: 'boolean' },
            isClosed: { type: 'boolean' },
            isDeleted: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            totalReceipts: { type: 'integer' },
            confirmedCount: { type: 'integer' },
            rejectedCount: { type: 'integer' },
            pendingCount: { type: 'integer' },
          },
        },
        PaymentReceipt: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
            fullName: { type: 'string' },
            matricNumber: { type: 'string' },
            level: { type: 'string', nullable: true },
            receiptUrl: { type: 'string', format: 'uri' },
            submittedAt: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'rejected'] },
            confirmedAt: { type: 'string', format: 'date-time', nullable: true },
            confirmedBy: { type: 'string', nullable: true },
            note: { type: 'string', nullable: true },
            extractedAmount: { type: 'string', nullable: true },
            amountCheckStatus: { type: 'string', enum: ['pending', 'matched', 'mismatch', 'unreadable', 'unavailable'] },
            ticketQrCode: { type: 'string', nullable: true },
            isClaimed: { type: 'boolean' },
            claimedAt: { type: 'string', format: 'date-time', nullable: true },
            claimedBy: { type: 'string', nullable: true },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['credit', 'debit'] },
            amount: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', nullable: true },
            occurredAt: { type: 'string', format: 'date-time' },
            proofUrl: { type: 'string', nullable: true },
            recorderName: { type: 'string', nullable: true },
            recorderRole: { type: 'string', nullable: true },
            receiptId: { type: 'string', format: 'uuid', nullable: true },
            isDeleted: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/swaggerDocs/*.ts'],
};

export default swaggerJsdoc(options);
