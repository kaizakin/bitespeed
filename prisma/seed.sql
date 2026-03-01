TRUNCATE TABLE "Contact" RESTART IDENTITY CASCADE;

INSERT INTO "Contact"
  ("id", "phoneNumber", "email", "linkedId", "linkPrecedence", "createdAt", "updatedAt", "deletedAt")
VALUES
  (1, '123456', 'lorraine@hillvalley.edu', NULL, 'primary', '2023-04-01T00:00:00.374Z', '2023-04-01T00:00:00.374Z', NULL),
  (23, '123456', 'mcfly@hillvalley.edu', 1, 'secondary', '2023-04-20T05:30:00.110Z', '2023-04-20T05:30:00.110Z', NULL),
  (11, '919191', 'george@hillvalley.edu', NULL, 'primary', '2023-04-11T00:00:00.374Z', '2023-04-11T00:00:00.374Z', NULL),
  (27, '717171', 'biffsucks@hillvalley.edu', NULL, 'primary', '2023-04-21T05:30:00.110Z', '2023-04-21T05:30:00.110Z', NULL);

SELECT setval(
  pg_get_serial_sequence('"Contact"', 'id'),
  COALESCE((SELECT MAX("id") FROM "Contact"), 1),
  true
);
