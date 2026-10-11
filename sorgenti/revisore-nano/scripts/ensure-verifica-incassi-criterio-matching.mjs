import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL non configurato");
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [columns] = await connection.query(
    "SHOW COLUMNS FROM `verifica_incassi_partite` LIKE 'criterioMatching'"
  );

  if (columns.length === 0) {
    await connection.query(
      "ALTER TABLE `verifica_incassi_partite` ADD COLUMN `criterioMatching` varchar(60)"
    );
  }

  const [updatedColumns] = await connection.query(
    "SHOW COLUMNS FROM `verifica_incassi_partite` LIKE 'criterioMatching'"
  );
  console.log(JSON.stringify(updatedColumns, null, 2));
} finally {
  await connection.end();
}
