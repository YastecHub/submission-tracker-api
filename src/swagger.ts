import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Submission Tracker API',
      version: '1.0.0',
      description:
        'API for managing digital submission confirmations in a university setting. ' +
        'CRs create events and confirm submissions; students submit without an account.',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT ?? 3001}`,
        description: 'Local development server',
      },
    ],
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
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export default swaggerJsdoc(options);
