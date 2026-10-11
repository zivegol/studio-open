import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const definitions = [
    ["s3KeyRisposta", "varchar(500)"],
    ["s3UrlRisposta", "text"],
    ["nomeFileRisposta", "varchar(255)"],
  ];
  for (const [name, type] of definitions) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`circolarizzazione_destinatari\` LIKE ?`, [name]);
    if (columns.length === 0) await connection.query(`ALTER TABLE \`circolarizzazione_destinatari\` ADD COLUMN \`${name}\` ${type}`);
  }
  console.log("Colonne risposta circolarizzazione verificate");
} finally {
  await connection.end();
}
