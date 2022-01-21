var mysql = require('mysql2');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var path = require('path');
var mv = require('mv');
var ftp = require("basic-ftp")
var formidable = require('formidable');
var net = require('net');
var fs = require('fs');

var connectionLogin = mysql.createConnection({
	host     : '172.17.0.2',
	user     : 'root',
	password : 'faceUnlock2021',
	database : 'nodelogin'
});

connectionLogin.connect(function(err) {
  if (err) throw err;
});

var connectionUSM = mysql.createConnection({
	host     : '172.17.0.2',
	user     : 'root',
	password : 'faceUnlock2021',
	database : 'gateUsersDatabase'
});

connectionUSM.connect(function(err) {
  if (err) throw err;
});

var app = express();
app.use(session({
	secret: 'secret',
	resave: true,
	saveUninitialized: true
}));
app.use(bodyParser.urlencoded({extended : true}));
app.use(bodyParser.json());
app.use(express.static('public'));


app.get('/', function(request, response) {
	response.sendFile(path.join(__dirname + '/login.html'));
});

app.post('/auth', function(request, response) {
	var username = request.body.username;
	var password = request.body.password;
	if (username && password) {
		connectionLogin.query('SELECT * FROM accounts WHERE username = ? AND password = ?', [username, password], function(error, results, fields) {
			if (results.length > 0) {
				request.session.loggedin = true;
				request.session.username = username;
				response.redirect('/home');
			} else {
				response.send('Incorrect Username and/or Password!');
			}			
			response.end();
		});
	} else {
		response.send('Please enter Username and Password!');
		response.end();
	}
});

app.post('/cadastrarUser', function(request, response)
{
    if (request.session.loggedin)
    {
        response.write('<!DOCTYPE html>');
        response.write('<html>');
            response.write('<head>');
                response.write('<meta charset="utf-8">')
                response.write('<title>FaceUnlock add Users</title>')
            response.write('</head>')
            response.write('<body>')
                response.write('<form action="addNewUser" method="post" enctype="multipart/form-data" id="addUserForm">')
                response.write('<label for="nome">Nome:</label>')
                response.write('<input type="text" id="nomeAdicionar" name="nomeAdicionar"><br><br>')
                response.write('<label for="horaUso">Hora de Uso:</label>')
                response.write('<input type="text" id="horaUso" name="horaUso">')
                response.write('<input type="file" id="fotoCadastrar" name="fotoCadastrar">')
                response.write('</form>')
                response.write('<p>Pressione o botão Submt para cadastrar o usuário ou o botão return para voltar para tela de usuários.</p>')
                response.write('<button type="submit" form="addUserForm" name="buttAddUserOrReturn" value="Submit">Submit</button>')
                response.write('<button type="submit" form="addUserForm" name="buttAddUserOrReturn" value="Return">Return</button>')
            response.write('</body>')
        response.write('</html>')
    }
    else
    {
		response.send('Not Authorized User');
        response.end();
    }
});

app.post('/addNewUser', function(request, response) {
    if (request.session.loggedin)
    {
            var form = new formidable.IncomingForm();
            
            form.parse(request, function (err, fields, files) 
            {
                var nomeAdicionar = fields.nomeAdicionar;
                var horaUso = fields.horaUso;
                var addUserOrReturn = fields.buttAddUserOrReturn;
                var fotoCadastrar = files.fotoCadastrar.originalFilename;
                if (addUserOrReturn=="Submit")
                {
                    //Inserindo Na Tabela
                    dbQuery= "INSERT INTO gateUsers (name, picture, useTime, encodedPicture) VALUES ('"+nomeAdicionar+"', 'temporary', '"+horaUso+"', 'temporary');";
                    connectionUSM.query(dbQuery);
                    //Atualizando foto filename
                    dbQuery= "UPDATE gateUsers SET picture=concat('foto', id, '"+fotoCadastrar.slice(-4)+"') WHERE name='"+nomeAdicionar+"';";
                    connectionUSM.query(dbQuery);
                    var oldpath = files.fotoCadastrar.filepath;
                    connectionUSM.query("SELECT * FROM gateUsers WHERE name='"+nomeAdicionar+"';", function (err, result, fields) 
                    {
                        var newpath =  path.join(__dirname +"/public/"+result[0].picture);
                        mv(oldpath, newpath, function (err)
                        {
                            if (err) throw err;
                            connectToFTPServerToUploadPicture(result[0].picture);
                            //Communicating with Processing Server to encode the new user image
                            var client = new net.Socket();
                            client.connect(12000, '192.168.0.12', function()
                            {
                                client.write('SENDING_IMAGE_TO_STORE_FILENAME='+result[0].picture);
                                var receveidString=0;
                                client.on('data', (data) =>
                                {;
                                    if (receveidString=="SENDING_ENCODED_FACE")
                                    {
                                        dbQuery= "UPDATE gateUsers SET encodedPicture='"+data.toString()+"' WHERE name='"+nomeAdicionar+"';";
                                        connectionUSM.query(dbQuery);
                                    }
                                    if (data.toString()=="SENDING_ENCODED_FACE")
                                    {
                                        console.log("Codificação realizada com sucesso");
                                        receveidString="SENDING_ENCODED_FACE";
                                        response.redirect('/home');
                                    }
                                    else
                                    {
                                        if(data.toString()=="IMAGE_ENCODING_FAILED")
                                        {
                                            console.log("Codificação falhou, tente outra imagem")
                                            fs.unlinkSync(path.join(__dirname +"/public/" + result[0].picture));
                                            connectToFTPServerToDeletePicture(result[0].picture);
                                            dbQuery= "DELETE FROM gateUsers WHERE name='"+nomeAdicionar+"';";
                                            connectionUSM.query(dbQuery);
                                            console.log(nomeAdicionar+" Deletado do banco de dados");
                                            response.redirect('/falhaCadastrar');
                                        }
                                    }
                                    
                                });
                            });
                            
                        });
                        
                    });
                }
            });
    }
    else
    {
        response.send('Not Authorized User');
        response.end();
    }
});

app.get('/falhaCadastrar', function(request, response){
    if (request.session.loggedin)
    {
        response.write('<!DOCTYPE html>');
        response.write('<html>');
            response.write('<head>');
                response.write('<meta charset="utf-8">')
                response.write('<title>FaceUnlock Fail at User Registers</title>')
            response.write('</head>')
            response.write('<body>')
                response.write('Imagem de cadastro Inválida')
                response.write('<form action="/home" method="get"><button name="voltarHome" ">Voltar</button></form>')
        response.write('</html>')
        response.end();
    }
    else
    {
		response.send('Not Authorized User');
        response.end();
    }
});

app.post('/deletarUser', function(request, response) {
    if (request.session.loggedin)
    {
        connectionUSM.query("SELECT * FROM gateUsers WHERE id='"+request.body.buttDeletar+"';", function (err, result, fields)
        {
            fs.unlinkSync(path.join(__dirname +"/public/" + result[0].picture));
            connectToFTPServerToDeletePicture(result[0].picture);
            dbQuery= "DELETE FROM gateUsers WHERE id="+request.body.buttDeletar+";";
            connectionUSM.query(dbQuery);
        });
        response.redirect('/home');
    }
    else
    {
        response.send('Not Authorized User');
        response.end();
    }
});

async function connectToFTPServerToDeletePicture(filename)
{
    var client = new ftp.Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: "192.168.0.12",
            user: "FTPUser",
            password: "faceUnlock2021",
            secure: false
        })
        await client.remove(filename);
    }
    catch(err) {
        console.log(err)
    }
    client.close()
}

async function connectToFTPServerToUploadPicture(filename)
{
    var client = new ftp.Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: "192.168.0.12",
            user: "FTPUser",
            password: "faceUnlock2021",
            secure: false
        })
        await client.uploadFrom(path.join(__dirname + '/public/'+filename), filename);
    }
    catch(err) {
        console.log(err)
    }
    client.close()
}

async function connectToFTPServerToDownloadPictures()
{
    var client = new ftp.Client()
    client.ftp.verbose = true
    try {
        await client.access({
            host: "192.168.0.12",
            user: "FTPUser",
            password: "faceUnlock2021",
            secure: false
        })
        lista = await client.list();
        for (let index = 0; index < lista.length; index++)
        {
            if (lista[index].name.slice(-4)==".png" || lista[index].name.slice(-4)==".jpg")
            {
                await client.downloadTo("public/"+lista[index].name, lista[index].name);
            }
        } 
    }
    catch(err) {
        console.log(err)
    }
    client.close()
}

app.get('/home', function(request, response) {
	if (request.session.loggedin) 
    {
		response.write('<!DOCTYPE html>');
        response.write('<html>');
            response.write('<head>');
                response.write('<meta charset="utf-8">')
                response.write('<title>FaceUnlock Users Manager</title>')
            response.write('</head>')
            response.write('<body>')
            response.write('<form action="/cadastrarUser" method="post"><button name="buttCadastrar"> Cadastrar User </button></form>')
                connectionUSM.connect(function(err)
                {
                    if (err) throw err;
                    connectionUSM.query("SELECT * FROM gateUsers", function (err, result, fields) 
                        {
                            if (err) throw err;
                            if (result.length>0)
                            {
                                connectToFTPServerToDownloadPictures()
                                //Create Tables
                                response.write('<table>')
                                    response.write('<tr>')
                                        response.write('<th>Id</th>')
                                        response.write('<th>Picture</th>')
                                        response.write('<th>Nome</th>')
                                        response.write('<th>Use Time</th>')
                                        response.write('<th>Excluir</th>')
                                    response.write('</tr>')
                                
                                for (let index = 0; index < result.length; index++)
                                {

                                    response.write('<tr>')
                                        response.write('<td>'+result[index].id+'</td>')
                                        response.write('<td><img src="'+result[index].picture+'" style="width:150px;height:200px"></td>')
                                        response.write('<td>'+result[index].name+'</td>')
                                        response.write('<td>'+result[index].useTime+'</td>')
                                        response.write('<td><form action="/deletarUser" method="post"><button name="buttDeletar" value="'+result[index].id+'">Excluir</button></form></td>')
                                    response.write('</tr>')
                                }   
                                response.write('</table>')
                            response.write('</body>')
                        response.write('</html>');
                            }
                            else
                            {
                            response.write('</body>')
                        response.write('</html>');
                        response.end();
                            }
                        });
                });
	} 
	else 
    {
		response.send('Not Authorized User');
        response.end();
	}
});




app.listen(3000);
console.log("WebServer pronto para ouvir")
