var express = require('express');
var bodyParser = require('body-parser');
var app = express();

var neo4j = require('neo4j');
var db = new neo4j.GraphDatabase(process.env['GRAPHSTORY_URL']);
db.params = {userId: db.id};

var Hashids = require('hashids');
var hashids = new Hashids('Smaller cap, less plastic');

var LRU = require('lru-cache');
var cache = LRU({max: 500, maxAge: 1000 * 60 * 5});

app.set('port', (process.env.PORT || 5000));
app.listen(app.get('port'), function() {
  console.log('Listening on port ' + app.get('port'));
});

app.use('/public', express.static(__dirname + '/public'));
app.use('/favicon.ico', express.static(__dirname + '/public/favicon.ico'));

app.use(bodyParser.json());

app.use(function (req, res, next) {
  console.log(req.method, req.url);
  next();
});

app.get('/api/graphs', function(req, res) {
  getAllGraphs(function(err, graphlist) {
    if (err) {
      console.log('Error in GET /api/graphs:', err);
      res.status(404).end();
      return;
    }

    var response = { graphs: graphlist };
    res.json(response);
  });
});

app.get('/api/nodes/:node_slug', function(req, res) {
  var node_slug = req.params.node_slug;

  getNode(node_slug, function(err, node) {
    if (err) {
      console.log(err);
      res.status(500).end();
      return;
    }
    if (!node) {
      res.status(404).send('Node does not exist');
      return;
    }

    var response = { node: node };
    res.json(response);
  });
});

app.get('/api/graphs/:graph_slug', function(req, res) {
  var graph_slug = req.params.graph_slug;

  getGraph(graph_slug, function(err, response) {
    if (err) {
      console.log(err);
      res.status(404).send('Graph does not exist');
    }
    
    res.json(response);
  });
});

app.put('/api/nodes/:node_slug', function(req, res) {
  //console.log(req.body);

  var incomingNode = {
    name: req.body.node.name,
    desc: req.body.node.desc,
    adjacencies: req.body.node.adjacencies,
    slug: req.params.node_slug
  };

  putNode(incomingNode, function(err) {
    if (err) {
      console.log(err);
      res.status(404).end();
    }
    else {
      res.status(200).json({});
    }
  })
});

app.post('/api/nodes', function(req, res) {
  //console.log(req.body);

  var newNode = {
    name: req.body.node.name
  };

  postNode(newNode, function(err, node) {
    if (err) {
      console.log(err);
      res.status(500).end();
      return;
    }

    res.json({ node: node });
  });
});

app.put('/api/graphs/:graph_slug', function(req, res) {
  var incomingGraph = {
    name: req.body.graph.name,
    nodes: req.body.graph.nodes,
    slug: req.params.graph_slug
  };

  putGraph(incomingGraph, function(err) {
    if (err) {
      console.log(err);
      res.status(404).end();
      return;
    }

    res.status(200).json({});
  });
});

app.delete('/api/nodes/:node_slug', function(req, res) {
  deleteNode(req.params.node_slug, function(err) {
    if (err) {
      console.log(err);
      res.status(404).end();
      return;
    }

    res.status(200).json({});
  })
});

// If all else fails: send them app.html
app.get('/*', function(req, res) {
  res.sendFile(__dirname + '/public/app.html');
});


// ////
// Database utility functions

function deleteNode(node_slug, callback) {
  // Deletes the node corresponding to the given node_slug from the database.
  // param callback: function(err)
  // Returns nothing.

  var nodeid = hashids.decode(node_slug);
  var query = 'START n=node({nodeid}) MATCH n-[r]-() DELETE n, r';
  var params = { nodeid: nodeid };
  db.query(query, params, function(err) {
    if (!err) {
      var cache_key = 'nodes/' + node_slug;
      cache.del(cache_key);
    }
    callback(err);
  });
}

function putGraph(graph, callback) {
  // Updates an existing graph to the database (PUT assumes that the graph
  //  already exists).
  // param incomingGraph: graph like { }
  // param callback: function(err)
  // Returns nothing.

  // Build the query.
  // For each node in the graph, create a CONTAINS relationship between the 
  //  graph and that node. This keeps orphaned nodes in the graph.
  var graph_id = hashids.decode(graph.slug)[0];
  var node_ids = [];
  graph.nodes.forEach(function(node_slug) {
    node_id = hashids.decode(node_slug)[0];
    node_ids.push(node_id);
  });

  var query = 'START g=node({graph_id}), n=node({node_ids}) ' +
    'MERGE g-[:CONTAINS]->n';
  var params = {
    graph_id: graph_id,
    node_ids: node_ids
  };
  db.query(query, params, function(err, result) {
    // TODO: cache.set
    callback(err);
  });
}

function postNode(newNode, callback) {
  // Creates a new node and returns it via callback. The returned node
  //  contains the new slug value.

  var query = 'CREATE (n:Node {name:{name}}) RETURN n, id(n)';
  var params = { name: newNode.name };
  db.query(query, params, function(err, result) {
    if (err) {
      callback(err, {});
      return;
    }

    row = result[0];
    newNode.slug = hashids.encode(row['id(n)']);
    // TODO: cache.set
    callback(err, newNode);
  });
}

function getAllGraphs(callback) {
  // Retrieves all Graphs from database
  // Returns: list of graphs like {slug:encoded_id}, ready for REST

  if (cache.has('graphs')) {
    callback(false, cache.get('graphs'));
    return;
  }

  db.query('MATCH (g:Graph) RETURN g', {}, function(err, result) {
    var graphlist = [];
    
    if (!err) {
      result.forEach(function(row) {
        var graphid = row['g'].id;
        var graphslug = hashids.encode(graphid);
        graphlist.push({slug:graphslug});
     });
    }

    cache.set('graphs', graphlist);
    callback(err, graphlist);
  });
}


function getNode(node_slug, callback) {
  // Retrieves a node from the database, including its adjacencies
  // Returns a REST-ready node object like
  //  { slug: encoded_slug, name, desc, adjacencies }

  // Return cached if present
  // var cache_key = 'nodes/' + node_slug;
  // if (cache.has(cache_key)) {
  //   callback(null, cache.get(cache_key));
  //   return;
  // }

  db.getNodeById(hashids.decode(node_slug), function(err, result) {
    if (err || !result) {
      callback(err, {});
      return;
    }

    var node = {
      slug: hashids.encode(result.id),
      name: result.data.name,
      desc: result.data.desc,
      adjacencies: []
    };

    var query = 'MATCH (adj:Node)--(n:Node) WHERE id(n) = {nodeid} RETURN adj';
    var params = {nodeid: result.id};
    db.query(query, params, function(err, result) {
      if (result) {
        result.forEach(function(row) {
          adjacentslug = hashids.encode(row['adj'].id);
          // TODO: cache the adjacents we just fetched
          node.adjacencies.push(adjacentslug);
        });
      }

      //cache.set(cache_key, node);
      callback(err, node);
    });
  });
}

function putNode(incomingNode, callback) {
  // Updates an existing node (PUT assumes that the node already exists).
  // param incomingNode: one node like { slug, name, desc, adjacencies }
  // Returns nothing.

  var cache_key = 'nodes/' + incomingNode.slug;
  var nodeid = hashids.decode(incomingNode.slug)[0];

  var adjacent_ids = []
  incomingNode.adjacencies.forEach(function(adj) {
    adjacent_ids.push(hashids.decode(adj)[0]);
  });

  var query = ['START n1=node({nodeid}),',
    'n2=node({adjacent_ids})',
    'MERGE (n1)-[:EDGE]->(n2)',
    'SET n1={n1props}'
  ].join('\n');
  var params = {
    nodeid: nodeid,
    adjacent_ids: adjacent_ids,
    n1props: {
      name: incomingNode.name || '',
      desc: incomingNode.desc || ''
    }
  };
  console.log(params);
  db.query(query, params, function(err) {
    //TODO: cache.set
    callback(err);
  });
}

function getGraph(graph_slug, callback) {
  // Fetches and returns (via callback) a graph corresponding to the provided
  //  slug.
  // param graph_slug: encoded slug. Once decoded, designates the id for a
  //  Graph object. Any and all nodes on any path with the Graph are
  //  considered part of the graph.
  // param callback: function of (err, graph), where graph is a REST-ready
  //  object, like { graph: { slug, nodes[] }, nodes: [sideloaded nodes] }

  var query = ['MATCH (g:Graph)--(n1:Node)',
    'WHERE id(g) = {graphid}',
    'OPTIONAL MATCH (n1)--(n2:Node)',
    'RETURN DISTINCT g, n1, n2'
    ].join('\n');
  var params = { graphid: hashids.decode(graph_slug) };
  db.query(query, params, function(err, result) {
    if (err || result.length == 0) {
      callback(err, result);
      return;
    }

    var graph = { slug: graph_slug, nodes: [] };
    var nodes = {};

    result.forEach(function(row) {
      var n1slug = hashids.encode(row['n1'].id);
      graph.nodes.push(n1slug);

      if (!nodes[n1slug]) {
        nodes[n1slug] = {};
        nodes[n1slug].slug = n1slug;
        nodes[n1slug].name = row['n1'].data.name;
        nodes[n1slug].desc  = row['n1'].data.desc;
        nodes[n1slug].adjacencies = [];
      }

      if (row['n2'] != null) {
        var n2slug = hashids.encode(row['n2'].id);
        nodes[n1slug].adjacencies.push(n2slug);
      }
    });

    // TODO: cache this graph
    // TODO: sideload nodes
    callback(err, { graph: graph });

    // Cache this graph's nodes
    Object.keys(nodes).forEach(function(key) {
      var node = nodes[key];
      var node_cache_key = 'nodes/' + node.slug;
      cache.set(node_cache_key, node);
    });
  });
}
