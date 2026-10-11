import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL non configurato");

const connection = await mysql.createConnection(databaseUrl);
try {
  const [columns] = await connection.query(
    "SHOW COLUMNS FROM `incarichi` LIKE 'nextcloudFolder'"
  );
  if (columns.length === 0) {
    await connection.query(
      "ALTER TABLE `incarichi` ADD COLUMN `nextcloudFolder` varchar(1000) NULL"
    );
  }
  const [updated] = await connection.query(
    "SHOW COLUMNS FROM `incarichi` LIKE 'nextcloudFolder'"
  );
  const [clientColumns] = await connection.query(
    "SHOW COLUMNS FROM `clienti` LIKE 'nextcloudFolder'"
  );
  if (clientColumns.length === 0) {
    await connection.query(
      "ALTER TABLE `clienti` ADD COLUMN `nextcloudFolder` varchar(1000) NULL"
    );
  }
  const [updatedClients] = await connection.query(
    "SHOW COLUMNS FROM `clienti` LIKE 'nextcloudFolder'"
  );
  console.log(JSON.stringify({ incarichi: updated, clienti: updatedClients }, null, 2));
} finally {
  await connection.end();
}
