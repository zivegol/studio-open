import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL non configurato");
}

const connection = await mysql.createConnection(databaseUrl);

try {
  await connection.query(
    "ALTER TABLE `verifica_incassi_sessioni` MODIFY COLUMN `movimentiBancariJson` mediumtext"
  );

  const [columns] = await connection.query(
    "SHOW COLUMNS FROM `verifica_incassi_sessioni` LIKE 'movimentiBancariJson'"
  );
  console.log(JSON.stringify(columns, null, 2));
} finally {
  await connection.end();
}
