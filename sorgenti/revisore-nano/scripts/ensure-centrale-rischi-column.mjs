import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL non configurato");
  process.exit(1);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await connection.query(
    "show columns from scheda_disponibilita_liquide like 'centraleRischi'"
  );

  if (columns.length === 0) {
    await connection.query(
      "alter table scheda_disponibilita_liquide add column centraleRischi json"
    );
    console.log("centraleRischi column added");
  } else {
    console.log("centraleRischi column already exists");
  }
} finally {
  await connection.end();
}
