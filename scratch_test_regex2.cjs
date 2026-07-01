const text = "\r\r\r\rBangladesh Film Institute\r2nd Film Appreciation Course\rWinter, 2005\r\r\rResult of the examination\r\r\rRoll No.\r\u0007Name\r\u0007Remarks\r\u0007\r\u000702\r\u0007Abul Kalam Azad\r\u0007Pass\r\u0007\r\u000704\r\u0007Syeda Zinath Haq\r\u0007Pass\r\u0007\r\u000705\r\u0007Md. Abdur Rokib\r\u0007Pass\r\u0007";

const regex = /(\d{2,3})[\s\x07\r\n]+([a-zA-Z\.\s\-\(\)]+?)[\s\x07\r\n]+(Pass|Fail|\d{2,3})/gi;
let match;
const students = [];
while ((match = regex.exec(text)) !== null) {
    students.push({ roll: match[1], name: match[2], score: match[3] });
}
console.log(students);
